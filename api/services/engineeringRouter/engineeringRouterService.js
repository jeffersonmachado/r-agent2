'use strict';

/**
 * api/services/engineeringRouter/engineeringRouterService.js
 *
 * EngineeringModelRouter — orquestração completa da V1:
 *   TASK → CLASSIFY (já feito na criação) → ROUTE → CONTEXT → CODE → PATCH VALIDATE →
 *   CONTROLLED APPLY → DETERMINISTIC TEST → (RED → FIX loop) → INDEPENDENT REVIEW →
 *   REGRESSION → GOVERNANCE → GREEN/RED.
 *
 * A autoridade de PASS é sempre o exitCode real do Test Runner e a decisão estruturada do
 * Reviewer — nunca o texto livre do LLM. Idempotente por lock (uma task não roda duas vezes
 * simultaneamente) e restart-safe (todo progresso é persistido antes de avançar de estado;
 * um restart no meio de uma tentativa apenas perde aquela tentativa parcial, não a task).
 *
 * ERV1-CLOSE-006: `tenantId` era usado ao mesmo tempo como (a) audiência do evento WebSocket e
 * (b) escopo para resolver a credencial de IA real (`getDecryptedAPIKey(tenantId, provider)`
 * dentro de `aiProviderService.js`). Como a rota HTTP passava o tenant do AGENTE AUTENTICADO
 * (`req.agent.tenantId`) para os dois usos, um usuário comum de um tenant cliente que cria e
 * roda uma Engineering Task fazia o Router resolver e gastar A CREDENCIAL/BUDGET DAQUELE
 * TENANT — enviando código-fonte real do RAP para o provider de IA configurado por um cliente,
 * não pela plataforma. Corrigido separando explicitamente:
 *   - `credentialScope` — SEMPRE `SYSTEM_ENGINEERING` (== `DEFAULT_TENANT_ID`,
 *     `ENGINEERING_ROUTER_TENANT_ID`), nunca influenciável pelo tenant de quem chama a API.
 *   - `eventAudienceTenantId` — o tenant real de quem abriu a tela, só usado para o WebSocket
 *     alcançar o cliente certo.
 */

const fs = require('fs');
const engineeringTaskService = require('./engineeringTaskService');
const { buildContext } = require('./contextBuilderService');
const { generatePatch } = require('./coderService');
const { review } = require('./reviewerService');
const { createWorkspace, applyPatch, destroyWorkspace, listChangedFiles } = require('./patchApplyService');
const { runTestCommands } = require('./testRunnerService');
const { buildAvailableModels, DEFAULT_TENANT_ID } = require('./engineeringModelAvailabilityService');
const modelAvailabilityStore = require('./modelAvailabilityStore');
const { checkRegression, checkGovernance } = require('./regressionGovernanceService');
const { createPromotionCandidate, verifyPromotedCandidate, findExistingCandidate, computeValidatedPatchHash } = require('./promotionService');
const missionSourceService = require('../engineeringMission/missionSourceService');
const operationService = require('./engineeringOperationService');
const { execFile } = require('child_process');
const util = require('util');
const { ROOT } = require('./contextBuilderService');

const execFileAsync = util.promisify(execFile);

async function runGitRevParseHead() {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: ROOT });
  return stdout.trim();
}
const { validatePatch } = require('../../../engine/engineeringRouter/patchValidator');
const { getPolicy, requiresIndependentReview } = require('../../../engine/engineeringRouter/routingPolicy');
const { selectCoderAndReviewer } = require('../../../engine/engineeringRouter/modelSelector');
const { FAILURE_CODES, TERMINAL_STATES, TEST_OUTCOMES } = require('../../../engine/engineeringRouter/constants');
const { emitTaskStage } = require('./engineeringRouterEvents');
const logger = require('../../utils/logger');
const os = require('os');
const crypto = require('crypto');
const { createTaskRun, isOwnershipLoss } = require('./taskRunContext');
const { resolvePolicy, policyMs, recordLivenessEvent } = require('../../utils/operationDeadline');

/**
 * Identidade de worker: UUID de instância. O PID NÃO entra na identidade (não é global entre
 * containers/hosts) — fica só nos logs como diagnóstico local.
 */
function newRunnerId() {
  return `engineer-${os.hostname()}-${crypto.randomUUID()}`;
}

/** Fachada de escrita: guardada por lease/fence quando há execução com posse; direta sem ela. */
function writesFor(run) {
  return run ? run.writes : engineeringTaskService;
}

async function recordProgress(run, signal, detail = null) {
  if (!run) return null;
  return run.progress(signal, detail);
}

/**
 * Cancelamento/perda de posse no meio de uma operação:
 *   - posse perdida ⇒ lança TASK_LEASE_LOST (o worker PARA; nada mais é escrito por ele);
 *   - cancelamento por NO_PROGRESS ⇒ a tentativa vira RETRY com diagnóstico (worker vivo,
 *     lease intacto — retry/replan, nunca takeover).
 */
async function handleOperationInterruption(run, err, attempt, ts) {
  if (!run) return null;
  if (isOwnershipLoss(run, err)) {
    const lost = new Error('posse da task perdida durante a operação — worker para de escrever');
    lost.code = FAILURE_CODES.TASK_LEASE_LOST;
    throw lost;
  }
  const cancelled = err && (err.code === 'OPERATION_CANCELLED' || err.code === 'NO_PROGRESS');
  if (cancelled && run.lastCancel && run.lastCancel.reason === 'NO_PROGRESS') {
    const diagnostics = run.lastCancel.diagnostics;
    run.lastCancel = null;
    await ts.updateAttempt(attempt.id, {
      status: 'FAILED',
      error: { code: 'NO_PROGRESS', message: `operação ${diagnostics.operation} cancelada: worker vivo sem progresso significativo`, diagnostics },
      completed_at: new Date(),
    });
    return {
      outcome: 'RETRY',
      failureBundle: {
        failedCommand: diagnostics.operation,
        failureKind: 'NO_PROGRESS',
        stderr: `NO_PROGRESS: ${diagnostics.reason}`,
      },
      attempt,
    };
  }
  return null;
}

/** Deadline adaptativo depois de TIMEOUT: dobra (teto 4x), sempre limitado ao `max` da política. */
function nextTimeoutMultiplier(failureBundle) {
  if (!failureBundle || failureBundle.failureKind !== TEST_OUTCOMES.TIMEOUT) return 1;
  return Math.min(4, (Number(failureBundle.timeoutMultiplier) || 1) * 2);
}

/**
 * ER-V1-FINAL-005 — Durable Resume.
 *
 * Achado real: um catch cego sobre transitionTask (sem checar o motivo real) aparecia em 3
 * pontos do loop
 * (CODING/TESTING/REVIEWING), com o comentário "já pode estar em CODING numa retomada — não é
 * fatal". Isso é verdadeiro para o ÚNICO caso em que a transição falha porque a task JÁ está
 * exatamente no estado de destino (idempotência real de retomada após crash) — mas o `.catch`
 * engolia QUALQUER erro: uma task já em estado TERMINAL por outro caminho (cancelamento
 * concorrente, corrida com outro runner), a task tendo sumido do banco (`not_found`), um erro
 * real de conexão — tudo silenciosamente ignorado, e o loop seguia operando sobre uma task cujo
 * estado real no banco já não fazia mais sentido.
 *
 * Substitui o `.catch` cego: só tolera a transição quando o estado ATUAL real (relido do
 * banco, nunca a variável em memória) já é EXATAMENTE o destino pedido — todo o resto propaga.
 */
async function tolerantTransition(taskId, toStatus, ts = engineeringTaskService) {
  try {
    return await ts.transitionTask(taskId, toStatus);
  } catch (err) {
    if (err.code !== FAILURE_CODES.INVALID_STATE_TRANSITION) throw err;

    const current = await ts.getTask(taskId);
    if (!current) throw err;

    if (current.status === toStatus) {
      // Retomada real: um processo anterior já fez esta transição antes de crashar depois
      // dela — idempotente, segue com o estado real já correto.
      return current;
    }

    if (TERMINAL_STATES.includes(current.status)) {
      // A task já terminou por outro caminho (cancelamento concorrente, outro runner) —
      // nunca prossegue silenciosamente operando sobre uma task morta.
      const terminalErr = new Error(`EngineeringTask já em estado terminal (${current.status}) durante tentativa de retomada para ${toStatus}`);
      terminalErr.code = 'TASK_ALREADY_TERMINAL_DURING_RESUME';
      terminalErr.currentStatus = current.status;
      throw terminalErr;
    }

    // Estado real diferente do esperado e não-terminal: cenário não coberto pela retomada
    // idempotente conhecida — propaga o erro original (nunca mascara).
    throw err;
  }
}

// Escopo canônico de credencial de IA do Engineering Router — nunca o tenant de quem chama a
// API. Mesmo valor/env var já usado por `engineeringModelAvailabilityService.js` e
// `engineeringAiInvoker.js` (autoridade única, não duplicada).
const ENGINEERING_CREDENTIAL_SCOPE = DEFAULT_TENANT_ID;

// ER-V1-SEALFIX-004 (Phase-Aware Durable Resume) — ordem real das fases dentro de
// `advanceFromCodedAttempt` (depois que CODING/TESTING/REVIEWING já terminaram com sucesso).
// Usada SOMENTE para decidir se uma transição de ENTRADA de fase deve ser pulada (retomada a
// partir de uma fase mais adiante que já passou de verdade antes do crash) — nunca para pular
// o TRABALHO real de cada fase, que continua sempre passando por
// `operationService.beginOrReconcile` (RESUME reaproveita evidência já persistida sem
// reexecutar nada; só decide isso a partir de evidência real, nunca da posição no array).
const ADVANCE_PHASE_ORDER = Object.freeze(['REVIEWING', 'REGRESSION', 'GOVERNANCE', 'PROMOTING', 'POST_PROMOTION_VERIFY', 'GREEN']);

/**
 * Transição de ENTRADA de fase, tolerante a retomada a partir de uma fase mais adiante: se
 * `currentStatusRef.value` já está NA FRENTE de `toStatus` em `ADVANCE_PHASE_ORDER` (retomada
 * depois de um crash que já persistiu progresso real além deste ponto), nunca tenta a
 * transição (que falharia como INVALID_STATE_TRANSITION — o state machine é estritamente
 * forward-only) — só confirma e segue. Do contrário, delega para `tolerantTransition` normal
 * (mesma tolerância a re-entrada no MESMO estado já existente desde ER-V1-FINAL-005).
 */
async function enterAdvancePhase(taskId, toStatus, currentStatusRef, ts = engineeringTaskService) {
  const curIdx = ADVANCE_PHASE_ORDER.indexOf(currentStatusRef.value);
  const targetIdx = ADVANCE_PHASE_ORDER.indexOf(toStatus);
  if (curIdx >= 0 && targetIdx >= 0 && curIdx > targetIdx) {
    return; // já passamos deste ponto numa retomada — nunca transição para trás.
  }
  await tolerantTransition(taskId, toStatus, ts);
  currentStatusRef.value = toStatus;
}

function contractFromTask(task) {
  return {
    allowedPaths: task.allowed_paths || [],
    forbiddenPaths: task.forbidden_paths || [],
    allowDeletes: false,
    // ER-V1-FINAL-003: campos consumidos por checkPathBoundary para a única exceção válida ao
    // fail-closed de allowedPaths vazio — nunca inferidos, sempre o valor exato persistido.
    scope: task.scope,
    explicitPolicyAuthorization: task.explicit_policy_authorization === true,
  };
}

/** Estágio ROUTE: seleciona CODER/REVIEWER e persiste a decisão (idempotente — não reprocessa se já ROUTED+). */
async function ensureRouted(task, { credentialScope, eventAudienceTenantId, run = null }) {
  if (task.status !== 'CLASSIFIED') return task;
  const ts = writesFor(run);

  const policy = getPolicy(task.task_type);
  const independentRequired = requiresIndependentReview(task.task_type, task.risk);
  const availableModels = await buildAvailableModels({ tenantId: credentialScope });

  const routingDecision = selectCoderAndReviewer(availableModels, {
    coderCapabilities: policy.coderCapabilities,
    reviewerCapabilities: policy.reviewerCapabilities,
    preferredCostClass: policy.preferredCostClass,
    independentReviewRequired: independentRequired,
    policyVersion: policy.policyVersion,
  });

  await ts.saveRoutingDecision(task.id, routingDecision);
  const routedTask = await ts.transitionTask(task.id, 'ROUTED');
  await recordProgress(run, 'state_transition', 'ROUTED');
  emitTaskStage(eventAudienceTenantId, task.id, {
    stage: 'ROUTED',
    status: 'success',
    message: `CODER ${routingDecision.coder?.selected ? `${routingDecision.coder.selected.providerId}:${routingDecision.coder.selected.modelId}` : 'nenhum qualificado'} · REVIEWER ${routingDecision.reviewer?.selected ? `${routingDecision.reviewer.selected.providerId}:${routingDecision.reviewer.selected.modelId}` : 'nenhum qualificado'}`,
    meta: { routingDecision },
  });
  return routedTask;
}

/** Um attempt completo: CODE → PATCH VALIDATE → APPLY → TEST → REVIEW. */
async function runOneAttempt({ task, routingDecision, failureBundle, previousAttempt, credentialScope, eventAudienceTenantId, run = null }) {
  const ts = writesFor(run);
  const coderSelection = routingDecision?.coder?.selected;
  if (!coderSelection) {
    return { outcome: 'FATAL', reasonCode: 'NO_QUALIFIED_CODER' };
  }

  await tolerantTransition(task.id, 'CODING', ts);

  const attempt = await ts.createAttempt(task.id, {
    status: 'CODING',
    coder_provider: coderSelection.providerId,
    coder_model: coderSelection.modelId,
    routing_reason_codes: routingDecision.coder.reasonCodes,
    failure_bundle: failureBundle || null,
  });

  emitTaskStage(eventAudienceTenantId, task.id, {
    stage: 'CODING',
    status: 'running',
    attemptNumber: attempt.attempt_number,
    message: `Tentativa ${attempt.attempt_number}: ${coderSelection.providerId}:${coderSelection.modelId} gerando patch…`,
  });

  const context = buildContext(task, { failureBundle, previousAttempt });
  await ts.updateAttempt(attempt.id, { context_summary: { includedFiles: context.includedFiles, blockedFiles: context.blockedFiles, skippedFiles: context.skippedFiles, budget: context.budget } });

  let patchResult;
  const telemetryBase = { task_id: task.id, attempt_id: attempt.id, role: 'CODER', provider: coderSelection.providerId, model: coderSelection.modelId };
  // Operação de PROVIDER: deadline da política PROVIDER_REQUEST (Deadline Manager); o signal junta
  // lease perdido + cancelamento por NO_PROGRESS. Baseline de SLOW = metade do deadline.
  const coderOp = run ? run.beginOperation('CODER_GENERATION', { baselineMs: Math.round(policyMs('PROVIDER_REQUEST') / 2) }) : null;
  try {
    patchResult = await generatePatch({
      context,
      providerId: coderSelection.providerId,
      modelId: coderSelection.modelId,
      tenantId: credentialScope,
      signal: coderOp ? coderOp.signal : null,
      deadlineMeta: run ? run.deadlineMeta(task, 'CODING') : {},
    });
  } catch (err) {
    if (run) run.endOperation(coderOp);
    const interrupted = await handleOperationInterruption(run, err, attempt, ts);
    if (interrupted) return interrupted;
    const timedOut = err.failureClass === 'PROVIDER_TIMEOUT';
    await ts.recordTelemetry({
      ...telemetryBase,
      input_tokens: err.usage?.prompt_tokens ?? null,
      output_tokens: err.usage?.completion_tokens ?? null,
      latency_ms: err.latencyMs ?? null,
      result: timedOut ? 'TIMEOUT' : 'FAILURE',
      event_type: timedOut ? 'PROVIDER_TIMEOUT' : null,
      detail: timedOut ? { ...err.expiry, fallback: 'REROUTE', outcome: 'ATTEMPT_TIMED_OUT' } : null,
    });
    await ts.updateAttempt(attempt.id, { status: 'FAILED', error: { code: err.code, message: err.message, failureClass: err.failureClass || null }, completed_at: new Date() });
    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'CODING',
      status: 'error',
      attemptNumber: attempt.attempt_number,
      message: timedOut ? `CODER expirou (PROVIDER_TIMEOUT) — tentando fallback: ${err.message}` : `CODER falhou: ${err.message}`,
      meta: { code: err.code, failureClass: err.failureClass || null },
    });
    if (err.code === FAILURE_CODES.PROVIDER_UNAVAILABLE) {
      // ERV1-CLOSE-008: provider saudável não implica que ESTE modelo funcione (ex.: 404
      // "modelo não existe"). Marca o modelo específico e sinaliza reroute em vez de derrubar a
      // task inteira de cara — o orquestrador tenta o próximo candidato qualificado antes de
      // desistir. PROVIDER_TIMEOUT segue o MESMO caminho (fallback), nunca mata a task.
      const classified = modelAvailabilityStore.classifyModelFailure(err);
      modelAvailabilityStore.markUnavailable(coderSelection.providerId, coderSelection.modelId, classified);
      return {
        outcome: 'REROUTE',
        role: 'CODER',
        failedModelKey: `${coderSelection.providerId}:${coderSelection.modelId}`,
        reasonCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
        failureClass: err.failureClass || null,
        providerElapsedMs: err.latencyMs ?? null,
        attempt,
      };
    }
    return { outcome: 'RETRY', failureBundle: { failedCommand: 'CODER_GENERATION', stderr: err.message, code: err.code }, attempt };
  }
  if (run) run.endOperation(coderOp);
  modelAvailabilityStore.markAvailable(coderSelection.providerId, coderSelection.modelId);
  await recordProgress(run, 'provider_response', `${coderSelection.providerId}:${coderSelection.modelId}`);

  await ts.recordTelemetry({
    ...telemetryBase,
    input_tokens: patchResult.usage?.prompt_tokens ?? null,
    output_tokens: patchResult.usage?.completion_tokens ?? null,
    latency_ms: patchResult.latencyMs,
    result: 'SUCCESS',
  });

  const validation = validatePatch(patchResult.diff, { contract: contractFromTask(task) });
  await ts.updateAttempt(attempt.id, { patch_diff: patchResult.diff, patch_validation: validation });

  if (!validation.ok) {
    await ts.updateAttempt(attempt.id, { status: 'PATCH_REJECTED', completed_at: new Date() });
    return { outcome: 'RETRY', failureBundle: { failedCommand: 'PATCH_VALIDATION', issues: validation.issues, code: validation.code }, attempt };
  }
  await recordProgress(run, 'patch_produced', `attempt ${attempt.attempt_number}`);

  let workspace = null;
  let keepWorkspace = false;
  try {
    workspace = await createWorkspace(task.id, attempt.attempt_number);
    await ts.updateAttempt(attempt.id, { workspace_path: workspace });

    const applyResult = await applyPatch(workspace, patchResult.diff);
    if (!applyResult.ok) {
      await ts.updateAttempt(attempt.id, { status: 'FAILED', error: { code: applyResult.code, stderr: applyResult.stderr }, completed_at: new Date() });
      emitTaskStage(eventAudienceTenantId, task.id, {
        stage: 'PATCH_APPLY',
        status: 'error',
        attemptNumber: attempt.attempt_number,
        message: `Falha ao aplicar patch: ${applyResult.code}`,
        meta: { stderr: applyResult.stderr },
      });
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'PATCH_APPLY', stderr: applyResult.stderr, code: applyResult.code }, attempt };
    }

    await ts.updateAttempt(attempt.id, { status: 'APPLIED' });
    await recordProgress(run, 'patch_applied', `attempt ${attempt.attempt_number}`);
    // Achado do pilot: mostrar os arquivos realmente tocados assim que o patch aplica é o
    // equivalente, para esta UI, à lista de arquivos editados que a extensão do VSCode mostra
    // em tempo real durante uma edição assistida por IA.
    const changedFiles = await listChangedFiles(workspace).catch(() => []);
    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'PATCH_APPLIED',
      status: 'success',
      attemptNumber: attempt.attempt_number,
      message: `Patch aplicado — ${changedFiles.length} arquivo(s) alterado(s).`,
      changedFiles,
    });

    await tolerantTransition(task.id, 'TESTING', ts);

    const testCommands = task.test_commands || [];
    const timeoutMultiplier = nextTimeoutMultiplier(failureBundle);
    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'TESTING',
      status: 'running',
      attemptNumber: attempt.attempt_number,
      message: testCommands.length ? `Rodando ${testCommands.length} comando(s) de teste…` : 'Nenhum testCommand definido.',
      meta: { commands: testCommands, timeoutMultiplier },
    });
    const testOp = run ? run.beginOperation('TEST_COMMANDS', { baselineMs: Math.round(policyMs('INTEGRATION_TEST') / 2) }) : null;
    let testResult;
    try {
      testResult = await runTestCommands({
        taskId: task.id,
        attemptNumber: attempt.attempt_number,
        commands: testCommands,
        cwd: workspace,
        timeoutMultiplier,
        signal: testOp ? testOp.signal : null,
        // Cada comando concluído é PROGRESSO real: uma suíte longa com comandos terminando nunca
        // é confundida com travamento.
        onCommandCompleted: (r) => recordProgress(run, 'command_completed', `${r.command} → ${r.outcome || r.status}`),
      });
    } catch (err) {
      if (run) run.endOperation(testOp);
      const interrupted = await handleOperationInterruption(run, err, attempt, ts);
      if (interrupted) return interrupted;
      throw err;
    }
    if (run) run.endOperation(testOp);

    for (const r of testResult.results) {
      await ts.createTestRun(attempt.id, {
        command: r.command,
        status: r.status,
        exit_code: r.exitCode,
        duration_ms: r.durationMs,
        stdout_ref: r.stdoutRef || null,
        stderr_ref: r.stderrRef || null,
        stdout_excerpt: r.stdoutExcerpt || null,
        stderr_excerpt: r.stderrExcerpt || null,
        started_at: r.startedAt ? new Date(r.startedAt) : null,
        completed_at: r.completedAt ? new Date(r.completedAt) : null,
      });
    }

    if (testCommands.length === 0) {
      await ts.updateAttempt(attempt.id, { status: 'FAILED', error: { code: 'NO_TEST_COMMANDS' }, completed_at: new Date() });
      emitTaskStage(eventAudienceTenantId, task.id, { stage: 'TESTING', status: 'error', attemptNumber: attempt.attempt_number, message: 'Nenhum testCommand definido — não há como validar o patch.' });
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'TEST_STAGE', stderr: 'Task Contract não define testCommands — nenhum teste determinístico para validar o patch.' }, attempt };
    }
    await recordProgress(run, 'test_result', testResult.outcome);

    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'TEST_RESULT',
      status: testResult.allPass ? 'success' : 'error',
      attemptNumber: attempt.attempt_number,
      message: testResult.allPass ? 'Todos os testes passaram.'
        : testResult.outcome === TEST_OUTCOMES.TIMEOUT ? 'Ao menos um teste excedeu o deadline (TIMEOUT — não é FAIL).'
          : testResult.outcome === TEST_OUTCOMES.INFRA_ERROR ? 'Infraestrutura de teste indisponível (INFRA_ERROR).'
            : 'Ao menos um teste falhou.',
      meta: { outcome: testResult.outcome, results: testResult.results.map((r) => ({ command: r.command, status: r.status, outcome: r.outcome || r.status, exitCode: r.exitCode })) },
    });

    if (!testResult.allPass) {
      const failed = testResult.results.find((r) => r.status !== 'PASS');
      await ts.updateAttempt(attempt.id, { status: 'FAILED', error: { code: `TEST_${testResult.outcome}`, outcome: testResult.outcome }, completed_at: new Date() });
      // Reação DIFERENTE por semântica (§26): INFRA_ERROR não prova nada sobre o patch ⇒ a task
      // fica BLOCKED_INFRA (nunca consome tentativas de CODER contra infraestrutura ausente);
      // TIMEOUT ⇒ retry com deadline adaptativo; FAIL ⇒ bug, retry RED→FIX.
      if (testResult.outcome === TEST_OUTCOMES.INFRA_ERROR) {
        return { outcome: 'BLOCKED_INFRA', reasonCode: FAILURE_CODES.BLOCKED_INFRA, detail: { command: failed.command, status: failed.status, reason: failed.reason || null }, attempt };
      }
      return {
        outcome: 'RETRY',
        failureBundle: {
          failedCommand: failed.command,
          exitCode: failed.exitCode,
          failureKind: testResult.outcome,
          timedOut: testResult.outcome === TEST_OUTCOMES.TIMEOUT,
          timeoutMultiplier,
          deadlineMs: failed.deadlineMs || testResult.deadlineMs || null,
          stderr: failed.stderrExcerpt || failed.reason,
          failedTests: [],
        },
        attempt,
      };
    }

    await ts.updateAttempt(attempt.id, { status: 'TESTED' });
    await tolerantTransition(task.id, 'REVIEWING', ts);

    const reviewerSelection = routingDecision?.reviewer?.selected;
    if (!reviewerSelection) {
      return { outcome: 'FATAL', reasonCode: 'NO_QUALIFIED_REVIEWER', attempt };
    }

    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'REVIEWING',
      status: 'running',
      attemptNumber: attempt.attempt_number,
      message: `${reviewerSelection.providerId}:${reviewerSelection.modelId} revisando o patch…`,
    });

    const reviewTelemetryBase = { task_id: task.id, attempt_id: attempt.id, role: 'REVIEWER', provider: reviewerSelection.providerId, model: reviewerSelection.modelId };
    let reviewResult;
    const reviewOp = run ? run.beginOperation('REVIEW', { baselineMs: Math.round(policyMs('PROVIDER_REQUEST') / 2) }) : null;
    try {
      reviewResult = await review({
        task: context.task,
        diff: patchResult.diff,
        testEvidence: testResult,
        contextFiles: context.files,
        providerId: reviewerSelection.providerId,
        modelId: reviewerSelection.modelId,
        tenantId: credentialScope,
        signal: reviewOp ? reviewOp.signal : null,
        deadlineMeta: run ? run.deadlineMeta(task, 'REVIEWING') : {},
      });
    } catch (err) {
      if (run) run.endOperation(reviewOp);
      const interrupted = await handleOperationInterruption(run, err, attempt, ts);
      if (interrupted) return interrupted;
      const timedOut = err.failureClass === 'PROVIDER_TIMEOUT';
      await ts.recordTelemetry({
        ...reviewTelemetryBase,
        result: timedOut ? 'TIMEOUT' : 'FAILURE',
        test_pass: true,
        event_type: timedOut ? 'PROVIDER_TIMEOUT' : null,
        detail: timedOut ? { ...err.expiry, fallback: 'REROUTE', outcome: 'ATTEMPT_TIMED_OUT' } : null,
      });
      emitTaskStage(eventAudienceTenantId, task.id, {
        stage: 'REVIEWING',
        status: 'error',
        attemptNumber: attempt.attempt_number,
        message: timedOut ? `Reviewer expirou (PROVIDER_TIMEOUT) — tentando fallback: ${err.message}` : `Reviewer falhou: ${err.message}`,
        meta: { code: err.code, failureClass: err.failureClass || null },
      });
      if (err.code === FAILURE_CODES.PROVIDER_UNAVAILABLE) {
        const classified = modelAvailabilityStore.classifyModelFailure(err);
        modelAvailabilityStore.markUnavailable(reviewerSelection.providerId, reviewerSelection.modelId, classified);
        return {
          outcome: 'REROUTE',
          role: 'REVIEWER',
          failedModelKey: `${reviewerSelection.providerId}:${reviewerSelection.modelId}`,
          reasonCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
          failureClass: err.failureClass || null,
          providerElapsedMs: err.latencyMs ?? null,
          attempt,
        };
      }
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'REVIEW_STAGE', stderr: err.message }, attempt };
    }
    if (run) run.endOperation(reviewOp);
    modelAvailabilityStore.markAvailable(reviewerSelection.providerId, reviewerSelection.modelId);

    await ts.recordTelemetry({
      ...reviewTelemetryBase,
      input_tokens: reviewResult.usage?.prompt_tokens ?? null,
      output_tokens: reviewResult.usage?.completion_tokens ?? null,
      latency_ms: reviewResult.latencyMs,
      result: 'SUCCESS',
      test_pass: true,
      review_result: reviewResult.decision,
    });

    await ts.createReview(attempt.id, {
      reviewer_provider: reviewerSelection.providerId,
      reviewer_model: reviewerSelection.modelId,
      decision: reviewResult.decision,
      findings: reviewResult.findings,
      independent_of_coder: routingDecision.independentReviewApplied,
    });
    await recordProgress(run, 'reviewer_result', reviewResult.decision);

    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'REVIEW_DECISION',
      status: reviewResult.decision === 'APPROVE' ? 'success' : 'error',
      attemptNumber: attempt.attempt_number,
      message: `${reviewResult.decision} — ${reviewerSelection.providerId}:${reviewerSelection.modelId}${routingDecision.independentReviewApplied ? ' (independente)' : ''}`,
      meta: { decision: reviewResult.decision, findings: reviewResult.findings },
    });

    if (reviewResult.decision === 'REJECT') {
      const blocking = reviewResult.findings.filter((f) => f.severity === 'BLOCKER' || f.severity === 'REGRESSION');
      await ts.updateAttempt(attempt.id, { status: 'FAILED', completed_at: new Date() });
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'REVIEW', findings: blocking }, attempt };
    }

    await ts.updateAttempt(attempt.id, { status: 'DONE', completed_at: new Date() });
    // ERV1-CLOSE-005: em caso de ADVANCE, o workspace com o patch já aplicado É o material que
    // a Promotion precisa (tree hash pós-patch) — não pode ser destruído aqui. O chamador
    // (`executeRoutedLoop`) assume a responsabilidade de destruí-lo depois que a promoção
    // (ou a decisão de não promover) terminar.
    keepWorkspace = true;
    return { outcome: 'ADVANCE', attempt, diff: patchResult.diff, testResult, workspace };
  } finally {
    if (workspace && !keepWorkspace) await destroyWorkspace(workspace);
  }
}

/**
 * Executa (ou retoma) uma EngineeringTask até um estado terminal ou até esgotar
 * `max_iterations`. Idempotente: se já estiver em estado terminal, retorna o estado atual sem
 * reprocessar.
 *
 * ERV1-CLOSE-006: `credentialScope` (resolução real de API key) e `eventAudienceTenantId`
 * (audiência do WebSocket) são parâmetros SEPARADOS de propósito — nunca reunifique isso.
 * `credentialScope` tem um default fixo (`ENGINEERING_CREDENTIAL_SCOPE`) e só deve ser
 * sobrescrito por chamadores internos/testes que precisam de isolamento (nunca pela camada
 * HTTP a partir do tenant de quem está autenticado).
 */
/**
 * Adquire o lock de execução (rápido: um round-trip de DB com `SELECT ... FOR UPDATE`, nunca
 * espera nenhuma chamada de LLM) e devolve o `task` já travado. Lança `TASK_ALREADY_RUNNING`
 * de verdade quando já existe uma execução em andamento — ponto usado tanto por `runTask`
 * (espera o loop inteiro) quanto por `beginRun` (ERV1-CLOSE-009: dispara o loop em background
 * só DEPOIS de garantir o lock, para a resposta HTTP poder refletir 409 de verdade em vez de
 * sempre 202 mesmo quando a segunda chamada concorrente nunca chega a rodar).
 */
async function acquireRunLock(taskId, runnerId, { lease = null } = {}) {
  const task = await engineeringTaskService.getTask(taskId);
  if (!task) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });

  // Usa TERMINAL_STATES (fonte única em constants.js) em vez de uma lista hardcoded — uma lista
  // solta aqui teria repetido o mesmo bug já encontrado e corrigido em computeOverview(): quando
  // READY_FOR_PROMOTION foi adicionado como estado terminal (ERV1-CLOSE-005), uma task que
  // termina ali (promoção bloqueada, ex: target divergido) não seria reconhecida como terminal e
  // uma nova chamada de /run tentaria travar e reexecutar uma task já finalizada.
  if (TERMINAL_STATES.includes(task.status)) {
    return { task, alreadyTerminal: true };
  }

  // PROPAGAÇÃO DE POSSE (§49): quando o chamador (recovery) já tomou o lease, a execução usa
  // EXATAMENTE aquele workerInstanceId + token + fence — nunca cria um "Runner B" com outra
  // identidade que seria recusado pelo próprio lease (ou, pior, reabriria o lease com fence novo
  // invalidando a posse que o recovery acabou de provar).
  if (lease && lease.token) {
    const current = await engineeringTaskService.getTaskLease(taskId);
    if (!current || current.token !== lease.token || current.workerInstanceId !== runnerId) {
      const err = new Error('lease propagado não é mais o vigente — outro worker assumiu a task');
      err.code = FAILURE_CODES.TASK_LEASE_LOST;
      throw err;
    }
    return { task, alreadyTerminal: false, lease: current, takeover: null };
  }

  // Posse NORMAL: TaskLease (CAS, fence+1). Não existe mais caminho de execução sem lease.
  const locked = await engineeringTaskService.lockForRun(taskId, runnerId, { host: os.hostname() });
  return { task, alreadyTerminal: false, lease: locked.lease, takeover: locked.leaseTakeover || null };
}

async function runLockedTask(task, { credentialScope, eventAudienceTenantId, specFreshnessGuard = null, lease, runnerId, onProgress = null }) {
  const taskId = task.id;
  // TASK START → heartbeat começa → (trabalho, renovações, progresso) → fim → heartbeat para →
  // lease é liberado. Nenhuma execução material acontece sem este contexto de posse.
  const run = createTaskRun({ taskId, runnerId, lease, onProgress });
  logger.info('[engineeringRouterService] execução com posse de lease', { taskId, runnerId, fence: lease.fence, pid: process.pid });
  try {
    return await executeRoutedLoop(task, { credentialScope, eventAudienceTenantId, specFreshnessGuard, run });
  } catch (err) {
    // POSSE PERDIDA: outro worker assumiu (heartbeat falhou / fence maior). Este worker PARA sem
    // escrever mais nada — o estado da task pertence ao novo dono.
    if (isOwnershipLoss(run, err)) {
      logger.warn('[engineeringRouterService] posse perdida — execução encerrada sem novas escritas', { taskId, runnerId, code: err.code });
      return { taskId, status: 'LEASE_LOST', reasonCode: FAILURE_CODES.TASK_LEASE_LOST, fence: lease.fence };
    }
    // Cancelamento concorrente (POST /tasks/:id/cancel enquanto este loop já estava rodando)
    // aparece como uma transição de estado agora inválida a partir de CANCELLED — tratado como
    // um resultado normal, nunca como exceção não tratada.
    if (err.code === FAILURE_CODES.INVALID_STATE_TRANSITION) {
      const current = await engineeringTaskService.getTask(taskId);
      if (current?.status === 'CANCELLED') {
        return { taskId, status: 'CANCELLED', reasonCode: 'CANCELLED_MID_RUN' };
      }
    }
    // ER-V1-FINAL-005: task já terminou por outro caminho (outro runner concluiu, cancelamento
    // concorrente detectado por tolerantTransition) durante uma tentativa de retomada — o
    // status real já é a fonte da verdade, nunca uma exceção não tratada subindo até o
    // fire-and-forget de beginRun.
    if (err.code === 'TASK_ALREADY_TERMINAL_DURING_RESUME') {
      return { taskId, status: err.currentStatus, reasonCode: 'TASK_ALREADY_TERMINAL_DURING_RESUME' };
    }
    throw err;
  } finally {
    run.stop();
    // Só libera o lease se ele ainda for DESTE worker (token): um worker que perdeu a posse nunca
    // apaga o lease do novo dono.
    await engineeringTaskService.releaseTaskLease(taskId, { leaseToken: lease.token }).catch(() => {});
  }
}

async function runTask(taskId, {
  runnerId = newRunnerId(),
  credentialScope = ENGINEERING_CREDENTIAL_SCOPE,
  eventAudienceTenantId = null,
  specFreshnessGuard = null,
  lease = null,
  onProgress = null,
} = {}) {
  const acquired = await acquireRunLock(taskId, runnerId, { lease });
  if (acquired.alreadyTerminal) return { taskId, status: acquired.task.status, idempotent: true };

  // Sem audiência explícita (ex.: worker de background sem requisição HTTP associada), o
  // evento cai no próprio credentialScope — mesmo default de sempre para quem não pediu uma
  // audiência específica. Nunca o inverso (nunca derivar credentialScope da audiência).
  const resolvedAudience = eventAudienceTenantId || credentialScope;
  return runLockedTask(acquired.task, {
    credentialScope,
    eventAudienceTenantId: resolvedAudience,
    specFreshnessGuard,
    lease: acquired.lease,
    runnerId,
    onProgress,
  });
}

/**
 * GUARD de fase material injetado pela camada que conhece o vínculo com a missão.
 *
 * O Router é GENÉRICO: ele não sabe o que é uma MissionSpec e não pode passar a saber (acoplaria
 * camadas). Mas é ele quem executa as fases com efeito real no git. A solução é INJEÇÃO: quem cria
 * a task fornece uma função que responde "este contrato ainda vale?". O Router apenas a invoca
 * antes de cada fase material e obedece. Sem guard injetado, o comportamento é o de sempre.
 */
async function assertSpecFresh(guard, phase, taskId) {
  if (typeof guard !== 'function') return;
  await guard({ phase, taskId });
}

/**
 * ERV1-CLOSE-009: variante para a camada HTTP. Adquire a POSSE (lease) de forma SÍNCRONA
 * (awaited) — uma segunda chamada concorrente genuína recebe `TASK_ALREADY_RUNNING` aqui, antes de
 * qualquer resposta HTTP ser enviada — e só então dispara o loop de execução em background.
 *
 * @returns {Promise<{taskId:string, status:string, accepted:boolean}>}
 */
async function beginRun(taskId, {
  runnerId = newRunnerId(),
  credentialScope = ENGINEERING_CREDENTIAL_SCOPE,
  eventAudienceTenantId = null,
} = {}) {
  const acquired = await acquireRunLock(taskId, runnerId);
  if (acquired.alreadyTerminal) return { taskId, status: acquired.task.status, accepted: false };

  const resolvedAudience = eventAudienceTenantId || credentialScope;
  // Fire-and-forget de propósito: a posse já foi adquirida de verdade acima (síncrono); o que
  // resta (chamadas de LLM, testes reais) pode legitimamente exceder o timeout de uma
  // requisição HTTP — e é o heartbeat que mantém a posse enquanto isso dura.
  runLockedTask(acquired.task, { credentialScope, eventAudienceTenantId: resolvedAudience, lease: acquired.lease, runnerId })
    .catch((err) => logger.error('[engineeringRouterService] beginRun: execução em background falhou', { taskId, error: err.message, code: err.code }));

  return { taskId, status: 'ACCEPTED', accepted: true, fence: acquired.lease.fence };
}

/**
 * Orçamento da cadeia de fallback de provider (§62): nunca loop infinito de reroute. Guardas do
 * registry (`PROVIDER_FALLBACK.guards`): tentativas e tempo total gasto em chamadas de provider que
 * falharam. Esgotar ⇒ PROVIDER_EXHAUSTED (task BLOCKED, missão replaneja) — nunca crash.
 */
function createProviderBudget() {
  const policy = resolvePolicy('PROVIDER_FALLBACK');
  const registryGuards = require('../../../engine/shared/executionDeadline').loadPolicyRegistry()?.policies?.PROVIDER_FALLBACK?.guards || {};
  return {
    maxAttempts: Number(registryGuards.maxProviderAttempts) || 6,
    maxElapsedMs: Math.min(Number(registryGuards.maxProviderElapsedMs) || policy.resolved, policy.resolved),
    failedAttempts: 0,
    elapsedMs: 0,
    timeouts: 0,
    register(result) {
      this.failedAttempts += 1;
      this.elapsedMs += Number(result.providerElapsedMs) || 0;
      if (result.failureClass === 'PROVIDER_TIMEOUT') this.timeouts += 1;
    },
    exhausted() {
      if (this.failedAttempts >= this.maxAttempts) return `tentativas de provider esgotadas (${this.failedAttempts}/${this.maxAttempts})`;
      if (this.elapsedMs >= this.maxElapsedMs) return `orçamento de tempo de provider esgotado (${this.elapsedMs}ms/${this.maxElapsedMs}ms)`;
      return null;
    },
  };
}

async function blockTask(taskId, ts, eventAudienceTenantId, { code, message, detail = null }) {
  logger.warn('[engineeringRouterService] task BLOCKED', { taskId, code, message });
  await ts.saveLastError(taskId, { code, message, ...(detail ? { detail } : {}) });
  await ts.transitionTask(taskId, 'BLOCKED');
  emitTaskStage(eventAudienceTenantId, taskId, { stage: 'BLOCKED', status: 'error', message, meta: { code, detail } });
  return { taskId, status: 'BLOCKED', reasonCode: code };
}

async function executeRoutedLoop(task, { credentialScope, eventAudienceTenantId, specFreshnessGuard = null, run = null }) {
  const taskId = task.id;
  const ts = writesFor(run);
  task = await ensureRouted(task, { credentialScope, eventAudienceTenantId, run });

  if (!task.routing_decision?.coder?.selected) {
    await ts.saveLastError(taskId, { code: 'NO_QUALIFIED_CODER', message: 'Nenhum CODER qualificado disponível' });
    await ts.transitionTask(taskId, 'RED');
    emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: 'Nenhum CODER qualificado disponível.' });
    return { taskId, status: 'RED', reasonCode: 'NO_QUALIFIED_CODER' };
  }

  const existingAttempts = await engineeringTaskService.listAttempts(taskId);
  let iterationsUsed = existingAttempts.length;
  let failureBundle = null;
  const lastAttempt = existingAttempts[existingAttempts.length - 1] || null;
  if (lastAttempt && lastAttempt.failure_bundle) failureBundle = lastAttempt.failure_bundle;

  // ER-V1-SEALFIX-004 (Phase-Aware Durable Resume) — antes de decidir criar uma tentativa nova,
  // verifica se a ÚLTIMA tentativa persistida já passou por CODING/TESTING/REVIEWING com sucesso
  // real e a TASK está numa fase pós-CODE — se sim, RETOMA por ali, nunca cria uma tentativa nova
  // redundante nem reexecuta REGRESSION/GOVERNANCE/PROMOTING do zero sem checar o que já é real.
  await assertSpecFresh(specFreshnessGuard, 'ADVANCE_RESUME', taskId);
  const resumed = await resumeAdvancePhaseIfNeeded(task, lastAttempt, { eventAudienceTenantId, run });
  if (resumed) return resumed;

  // ERV1-CLOSE-008: acumula, para esta execução da task, todo modelo que já falhou por
  // indisponibilidade real — nunca reselecionar o mesmo candidato quebrado num reroute
  // seguinte dentro da mesma task.
  const excludedModelKeys = new Set();
  const providerBudget = createProviderBudget();

  while (iterationsUsed < task.max_iterations) {
    // Fase CODING: consome LLM, gera patch e cria workspace. É trabalho material — não roda sobre
    // contrato obsoleto.
    await assertSpecFresh(specFreshnessGuard, 'CODING', taskId);
    if (run) await run.assertHeld();
    const result = await runOneAttempt({ task, routingDecision: task.routing_decision, failureBundle, previousAttempt: lastAttempt, credentialScope, eventAudienceTenantId, run });
    iterationsUsed += 1;

    if (result.outcome === 'FATAL') {
      await ts.saveLastError(taskId, { code: result.reasonCode, message: `Falha fatal: ${result.reasonCode}` });
      await ts.transitionTask(taskId, 'RED');
      emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: `Falha fatal: ${result.reasonCode}` });
      return { taskId, status: 'RED', reasonCode: result.reasonCode };
    }

    if (result.outcome === 'BLOCKED_INFRA') {
      // INFRA_ERROR não diz nada sobre o patch: nunca RED, nunca queima tentativas de CODER.
      return blockTask(taskId, ts, eventAudienceTenantId, {
        code: FAILURE_CODES.BLOCKED_INFRA,
        message: `Infraestrutura de execução indisponível (${result.detail?.status || 'INFRA_ERROR'}) — task BLOCKED_INFRA, nenhum veredito sobre o patch.`,
        detail: result.detail,
      });
    }

    if (result.outcome === 'REROUTE') {
      excludedModelKeys.add(result.failedModelKey);
      providerBudget.register(result);
      if (result.failureClass === 'PROVIDER_TIMEOUT') recordLivenessEvent('TIMEOUT_FALLBACK', { taskId, failedModelKey: result.failedModelKey, role: result.role });
      const exhaustedReason = providerBudget.exhausted();
      if (exhaustedReason) {
        recordLivenessEvent('PROVIDER_EXHAUSTED', { taskId, reason: exhaustedReason });
        return blockTask(taskId, ts, eventAudienceTenantId, {
          code: FAILURE_CODES.PROVIDER_EXHAUSTED,
          message: `PROVIDER_EXHAUSTED: ${exhaustedReason} — a missão pode replanejar; o worker segue vivo.`,
          detail: { failedAttempts: providerBudget.failedAttempts, elapsedMs: providerBudget.elapsedMs, timeouts: providerBudget.timeouts },
        });
      }
      const policy = getPolicy(task.task_type);
      const independentRequired = requiresIndependentReview(task.task_type, task.risk);
      const availableModels = await buildAvailableModels({ tenantId: credentialScope });
      const newRoutingDecision = selectCoderAndReviewer(availableModels, {
        coderCapabilities: policy.coderCapabilities,
        reviewerCapabilities: policy.reviewerCapabilities,
        preferredCostClass: policy.preferredCostClass,
        independentReviewRequired: independentRequired,
        policyVersion: policy.policyVersion,
        excludedModelKeys,
      });

      const stillNoCandidate = result.role === 'CODER'
        ? !newRoutingDecision.coder?.selected
        : !newRoutingDecision.reviewer?.selected;

      if (stillNoCandidate) {
        if (providerBudget.timeouts > 0 && providerBudget.timeouts === providerBudget.failedAttempts) {
          // Toda a cadeia caiu por TIMEOUT de provider: é dependência externa esgotada, não bug do
          // patch nem da task — BLOCKED (replanejável), nunca RED.
          recordLivenessEvent('PROVIDER_EXHAUSTED', { taskId, reason: 'NO_ALTERNATIVE_AFTER_TIMEOUTS' });
          return blockTask(taskId, ts, eventAudienceTenantId, {
            code: FAILURE_CODES.PROVIDER_EXHAUSTED,
            message: `PROVIDER_EXHAUSTED: nenhum ${result.role} alternativo após ${providerBudget.timeouts} timeout(s) de provider.`,
            detail: { failedAttempts: providerBudget.failedAttempts, timeouts: providerBudget.timeouts },
          });
        }
        await ts.saveLastError(taskId, {
          code: FAILURE_CODES.NO_ALTERNATIVE_CANDIDATE,
          message: `Nenhum ${result.role} alternativo disponível após ${result.failedModelKey} falhar (${result.reasonCode})`,
        });
        await ts.transitionTask(taskId, 'RED');
        emitTaskStage(eventAudienceTenantId, taskId, {
          stage: 'RED',
          status: 'error',
          message: `Nenhum ${result.role} alternativo qualificado após ${result.failedModelKey} falhar.`,
        });
        return { taskId, status: 'RED', reasonCode: FAILURE_CODES.NO_ALTERNATIVE_CANDIDATE };
      }

      await ts.saveRoutingDecision(taskId, newRoutingDecision);
      task = { ...task, routing_decision: newRoutingDecision };
      const newSelection = result.role === 'CODER' ? newRoutingDecision.coder.selected : newRoutingDecision.reviewer.selected;
      emitTaskStage(eventAudienceTenantId, taskId, {
        stage: 'REROUTE',
        status: 'info',
        message: `${result.failedModelKey} ${result.failureClass === 'PROVIDER_TIMEOUT' ? 'expirou (PROVIDER_TIMEOUT)' : 'indisponível'} — reroteado para ${newSelection.providerId}:${newSelection.modelId} (${result.role}).`,
        meta: { failedModelKey: result.failedModelKey, role: result.role, reasonCode: result.reasonCode, failureClass: result.failureClass || null },
      });
      failureBundle = { failedCommand: `${result.role}_REROUTE`, stderr: `${result.failedModelKey} indisponível (${result.reasonCode}${result.failureClass ? `/${result.failureClass}` : ''})` };
      logger.info('[engineeringRouterService] reroute de modelo', { taskId, role: result.role, failedModelKey: result.failedModelKey, failureClass: result.failureClass || null });
      continue;
    }

    if (result.outcome === 'ADVANCE') {
      // Fase pós-CODING: REGRESSION/GOVERNANCE e, sobretudo, PROMOTING (candidate commit + branch
      // já criados = efeito real e irreversível). Revalida ANTES de promover.
      await assertSpecFresh(specFreshnessGuard, 'ADVANCE_PROMOTION', taskId);
      return advanceFromCodedAttempt(task, result, { eventAudienceTenantId, run });
    }

    // RETRY
    failureBundle = result.failureBundle;
    emitTaskStage(eventAudienceTenantId, taskId, {
      stage: 'RETRY',
      status: 'info',
      message: `Tentativa ${iterationsUsed}/${task.max_iterations} falhou (${failureBundle?.failedCommand || 'motivo desconhecido'}${failureBundle?.failureKind ? ` — ${failureBundle.failureKind}` : ''}) — iniciando nova tentativa.`,
    });
    logger.info('[engineeringRouterService] RED->FIX: nova tentativa', { taskId, iterationsUsed, reason: failureBundle?.failedCommand, failureKind: failureBundle?.failureKind || null });
  }

  await ts.saveLastError(taskId, { code: FAILURE_CODES.ENGINEERING_TASK_EXHAUSTED, message: `Esgotadas ${task.max_iterations} tentativas` });
  await ts.transitionTask(taskId, 'RED');
  emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: `Esgotadas ${task.max_iterations} tentativas.` });
  return { taskId, status: 'RED', reasonCode: FAILURE_CODES.ENGINEERING_TASK_EXHAUSTED };
}

/**
 * ER-V1-SEALFIX-004 (Phase-Aware Durable Resume) — extraído de dentro do loop de
 * `executeRoutedLoop` para ser reentrante: chamado tanto no fluxo normal (logo após
 * `runOneAttempt` retornar ADVANCE) quanto no fluxo de RESUME (quando o processo reinicia com a
 * task já em REGRESSION/GOVERNANCE/PROMOTING/POST_PROMOTION_VERIFY — ver
 * `resumeAdvancePhaseIfNeeded`). Em ambos os casos o contrato é o mesmo: um `attempt` cujo
 * CODING/TESTING/REVIEWING já terminou com sucesso de verdade (patch validado, testado e
 * aprovado), com `diff`/`workspace` reais prontos para REGRESSION→GOVERNANCE→PROMOTING→
 * POST_PROMOTION_VERIFY→GREEN.
 *
 * Nunca duplica efeito colateral: cada fase usa `operationService.beginOrReconcile` (já provado
 * em ER-V1-SEAL-002) — RESUME reaproveita evidência já persistida, RECONCILE decide com base em
 * evidência real (ex.: `findExistingCandidate` para PROMOTING), FAIL_SAFE nunca roda
 * concorrentemente com outra execução real da MESMA fase.
 */
async function advanceFromCodedAttempt(task, result, { eventAudienceTenantId, run = null }) {
  const taskId = task.id;
  const ts = writesFor(run);
  // Efeitos de fase (operações de REGRESSION/GOVERNANCE/PROMOTING) só com posse comprovada.
  const held = async () => { if (run) await run.assertHeld(); };
  // ERV1-CLOSE-005: `runOneAttempt` deliberadamente NÃO destrói o workspace num ADVANCE —
  // a Promotion precisa dele (tree pós-patch) mais abaixo. Esta função assume a
  // responsabilidade de destruí-lo, em QUALQUER saída deste bloco (RED de regressão/
  // governança, READY_FOR_PROMOTION, ou GREEN).
  const attemptId = result.attempt.id;
  // ER-V1-SEALFIX-004 — rastreado à parte de `task.status` (que pode ficar desatualizado
  // dentro desta função): `enterAdvancePhase` atualiza esta referência a cada transição real
  // bem-sucedida, permitindo detectar corretamente "já passamos por aqui" mesmo numa retomada
  // que começa várias fases à frente do valor original de `task.status`.
  const currentStatusRef = { value: task.status };
  try {
        await enterAdvancePhase(taskId, 'REGRESSION', currentStatusRef, ts);
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'REGRESSION', status: 'running', message: 'Executando RegressionPlan real (proporcional ao risco) em workspace isolado.' });

        // ER-V1-SEAL-002 (Full Durable Resume): REGRESSION nunca tem efeito colateral externo
        // irreversível (só executa comandos e persiste evidência) — um RUNNING órfão (crash no
        // meio) é seguro reexecutar do zero. RESUME reusa a evidência já persistida sem rodar
        // os comandos de novo; FAIL_SAFE nunca roda concorrentemente com outra execução real.
        await held();
        const regressionOp = await operationService.beginOrReconcile({ taskId, attemptId, phase: 'REGRESSION' });
        let regressionResult;
        if (regressionOp.action === 'RESUME') {
          regressionResult = { pass: true, evidence: regressionOp.operation.evidence_ref };
        } else {
          if (regressionOp.action === 'FAIL_SAFE') {
            throw Object.assign(new Error('REGRESSION já está em execução em outro processo — nunca duplicar concorrentemente'), { code: 'OPERATION_STILL_RUNNING', phase: 'REGRESSION' });
          }
          if (regressionOp.action === 'RECONCILE') {
            await operationService.forceRun(regressionOp.operation.id, { reason: 'REGRESSION não tem efeito colateral externo irreversível — seguro repetir após RUNNING órfão' });
          }
          // ER-V1-FINAL-006: REGRESSION executa de verdade um RegressionPlan proporcional ao
          // risco declarado (LOW: targeted; MEDIUM: +related; HIGH: +subsystem; CRITICAL:
          // +governance gate) — nunca mais uma simples releitura de evidência da fase TESTING.
          const touchedPaths = await listChangedFiles(result.workspace).catch(() => []);
          const regressionLiveOp = run ? run.beginOperation('REGRESSION', { baselineMs: Math.round(policyMs('REGRESSION') / 2) }) : null;
          try {
            regressionResult = await checkRegression({
              taskId,
              attemptId,
              workspacePath: result.workspace,
              touchedPaths,
              risk: task.risk,
              targetedCommands: task.test_commands || [],
              signal: regressionLiveOp ? regressionLiveOp.signal : null,
              onCommandCompleted: (r) => recordProgress(run, 'command_completed', `regressão: ${r.command} → ${r.outcome || r.status}`),
              assertHeld: run ? () => run.assertHeld() : null,
            });
          } catch (err) {
            if (run) run.endOperation(regressionLiveOp);
            if (isOwnershipLoss(run, err)) throw err;
            if (err.code === 'OPERATION_CANCELLED' || err.code === 'NO_PROGRESS') {
              await operationService.failOperation(regressionOp.operation.id, { error: new Error('regressão cancelada por NO_PROGRESS') });
              return blockTask(taskId, ts, eventAudienceTenantId, { code: 'REGRESSION_NO_PROGRESS', message: 'Regressão cancelada: worker vivo sem progresso significativo (diagnóstico registrado).' });
            }
            throw err;
          }
          if (run) run.endOperation(regressionLiveOp);
          if (regressionResult.pass) {
            await operationService.completeOperation(regressionOp.operation.id, { evidenceRef: regressionResult.evidence });
          } else {
            await operationService.failOperation(regressionOp.operation.id, { error: new Error('regressão reprovou') });
          }
        }
        await ts.updateAttempt(attemptId, { regression_evidence: regressionResult.evidence });
        await recordProgress(run, 'regression_completed', regressionResult.outcome || (regressionResult.pass ? 'PASS' : 'FAIL'));
        if (!regressionResult.pass && (regressionResult.outcome === TEST_OUTCOMES.INFRA_ERROR || regressionResult.outcome === TEST_OUTCOMES.TIMEOUT)) {
          // TIMEOUT/INFRA_ERROR na regressão NÃO são reprovação do patch — nunca RED por isso.
          return blockTask(taskId, ts, eventAudienceTenantId, {
            code: regressionResult.outcome === TEST_OUTCOMES.INFRA_ERROR ? FAILURE_CODES.BLOCKED_INFRA : 'REGRESSION_TIMEOUT',
            message: `Regressão sem veredito (${regressionResult.outcome}) — task BLOCKED para replanejar, nunca RED por timeout/infra.`,
            detail: regressionResult.evidence,
          });
        }
        if (!regressionResult.pass) {
          await ts.saveLastError(taskId, { code: FAILURE_CODES.REGRESSION_FAILED, message: 'Regressão real reprovou após review aprovar', evidence: regressionResult.evidence });
          await tolerantTransition(taskId, 'RED', ts);
          emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: 'Regressão reprovou — nunca GREEN sem evidência real.', meta: regressionResult.evidence });
          return { taskId, status: 'RED', reasonCode: FAILURE_CODES.REGRESSION_FAILED };
        }
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'REGRESSION', status: 'success', message: `Regressão real: ${regressionResult.evidence.commandCount || 0} comando(s) PASS.`, meta: regressionResult.evidence });

        await enterAdvancePhase(taskId, 'GOVERNANCE', currentStatusRef, ts);
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'GOVERNANCE', status: 'running', message: 'Executando gate de governança real (scripts/governance/validate-engineering-router-v1.js).' });

        // Mesma lógica de reconciliação de REGRESSION — GOVERNANCE também não tem efeito
        // colateral externo irreversível.
        await held();
        const governanceOp = await operationService.beginOrReconcile({ taskId, attemptId, phase: 'GOVERNANCE' });
        let governanceResult;
        if (governanceOp.action === 'RESUME') {
          governanceResult = { pass: true, evidence: governanceOp.operation.evidence_ref };
        } else {
          if (governanceOp.action === 'FAIL_SAFE') {
            throw Object.assign(new Error('GOVERNANCE já está em execução em outro processo — nunca duplicar concorrentemente'), { code: 'OPERATION_STILL_RUNNING', phase: 'GOVERNANCE' });
          }
          if (governanceOp.action === 'RECONCILE') {
            await operationService.forceRun(governanceOp.operation.id, { reason: 'GOVERNANCE não tem efeito colateral externo irreversível — seguro repetir após RUNNING órfão' });
          }
          // ERV1-CLOSE-004: GOVERNANCE executa de verdade a autoridade canônica já existente —
          // nunca reimplementa governança, nunca finge sucesso por status.
          const governanceLiveOp = run ? run.beginOperation('GOVERNANCE_GATE', { baselineMs: Math.round(policyMs('REGRESSION_COMMAND') / 2) }) : null;
          try {
            governanceResult = await checkGovernance({ signal: governanceLiveOp ? governanceLiveOp.signal : null });
          } catch (err) {
            if (run) run.endOperation(governanceLiveOp);
            if (isOwnershipLoss(run, err)) throw err;
            if (err.code === 'OPERATION_CANCELLED') {
              await operationService.failOperation(governanceOp.operation.id, { error: new Error('gate cancelado por NO_PROGRESS') });
              return blockTask(taskId, ts, eventAudienceTenantId, { code: 'GOVERNANCE_NO_PROGRESS', message: 'Gate de governança cancelado: sem progresso significativo.' });
            }
            throw err;
          }
          if (run) run.endOperation(governanceLiveOp);
          if (governanceResult.pass) {
            await operationService.completeOperation(governanceOp.operation.id, { evidenceRef: governanceResult.evidence });
          } else {
            await operationService.failOperation(governanceOp.operation.id, { error: new Error('gate de governança reprovou') });
          }
        }
        await ts.updateAttempt(attemptId, { governance_evidence: governanceResult.evidence });
        await recordProgress(run, 'gate_completed', governanceResult.outcome || (governanceResult.pass ? 'PASS' : 'FAIL'));
        if (!governanceResult.pass && (governanceResult.outcome === TEST_OUTCOMES.TIMEOUT || governanceResult.outcome === TEST_OUTCOMES.INFRA_ERROR)) {
          return blockTask(taskId, ts, eventAudienceTenantId, {
            code: governanceResult.outcome === TEST_OUTCOMES.TIMEOUT ? 'GOVERNANCE_TIMEOUT' : FAILURE_CODES.BLOCKED_INFRA,
            message: `Gate de governança sem veredito (${governanceResult.outcome}) — BLOCKED, nunca RED por timeout/infra.`,
            detail: governanceResult.evidence,
          });
        }
        if (!governanceResult.pass) {
          await ts.saveLastError(taskId, { code: FAILURE_CODES.GOVERNANCE_FAILED, message: 'Gate de governança real reprovou', evidence: governanceResult.evidence });
          await tolerantTransition(taskId, 'RED', ts);
          emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: 'Governance reprovou — nunca GREEN sem o gate real passando.', meta: governanceResult.evidence });
          return { taskId, status: 'RED', reasonCode: FAILURE_CODES.GOVERNANCE_FAILED };
        }
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'GOVERNANCE', status: 'success', message: 'Gate de governança real: PASS.', meta: governanceResult.evidence });

        // ER-V1-SEAL-002: PROMOTING é o ponto MAIS crítico — `createPromotionCandidate` tem
        // efeito real e IRREVERSÍVEL (commit + branch reais). Um RUNNING órfão aqui NUNCA pode
        // ser tratado como "seguro repetir" sem antes checar evidência EXTERNA real (a branch
        // candidata já existe?) — nunca promover duas vezes por crash.
        await enterAdvancePhase(taskId, 'PROMOTING', currentStatusRef, ts);
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'PROMOTION', status: 'running', message: 'Promovendo patch validado (commit + branch local dedicada, sem push/merge).' });

        const validatedPatchHashForReconcile = computeValidatedPatchHash(result.diff);
        await held();
        const promotingOp = await operationService.beginOrReconcile({ taskId, attemptId, phase: 'PROMOTING' });
        let candidateResult;
        if (promotingOp.action === 'RESUME') {
          candidateResult = { created: true, evidence: promotingOp.operation.evidence_ref };
        } else {
          if (promotingOp.action === 'FAIL_SAFE') {
            throw Object.assign(new Error('PROMOTING já está em execução em outro processo — nunca duplicar concorrentemente'), { code: 'OPERATION_STILL_RUNNING', phase: 'PROMOTING' });
          }
          if (promotingOp.action === 'RECONCILE') {
            const existing = await findExistingCandidate({ taskId, validatedPatchHash: validatedPatchHashForReconcile });
            if (existing.found) {
              // Evidência EXTERNA real confirma: o candidate já foi criado antes do crash.
              // NUNCA chama createPromotionCandidate de novo — reconstrói o resultado a partir
              // do que já existe de verdade no git.
              const targetHeadNow = await runGitRevParseHead();
              candidateResult = {
                created: true,
                evidence: {
                  candidateCommit: existing.candidateCommit,
                  candidateBranch: existing.candidateBranch,
                  validatedPatchHash: validatedPatchHashForReconcile,
                  targetCommit: targetHeadNow,
                  targetHead: targetHeadNow,
                  // ER-V1-SEALFIX-004: sem isto, verifyPromotedCandidate (POST_PROMOTION_VERIFY)
                  // recebia validatedTreeHash=undefined e nunca confirmava — a task terminava em
                  // READY_FOR_PROMOTION mesmo com o candidate real e correto já promovido.
                  candidateTreeHash: existing.candidateTreeHash,
                  validatedTreeHash: existing.validatedTreeHash,
                  reconciledFromExternalEvidence: true,
                },
              };
              await operationService.resumeWithEvidence(promotingOp.operation.id, { evidenceRef: candidateResult.evidence, reason: 'branch candidata real encontrada com o mesmo validatedPatchHash' });
            } else {
              await operationService.forceRun(promotingOp.operation.id, { reason: 'nenhuma branch candidata real encontrada — seguro criar o candidate agora' });
            }
          }
          if (!candidateResult) {
            candidateResult = await createPromotionCandidate({
              taskId,
              attemptId,
              attemptNumber: result.attempt.attempt_number,
              workspacePath: result.workspace,
              diff: result.diff,
              taskTitle: task.title,
            });
            if (candidateResult.created) {
              await operationService.completeOperation(promotingOp.operation.id, { evidenceRef: candidateResult.evidence });
            } else {
              await operationService.failOperation(promotingOp.operation.id, { error: new Error(candidateResult.code || 'falha ao criar candidate') });
            }
          }
        }

        if (!candidateResult.created) {
          await ts.updateAttempt(attemptId, {
            promotion_evidence: { ...candidateResult.evidence, code: candidateResult.code },
            promotion_status: 'READY_FOR_PROMOTION',
          });
          await tolerantTransition(taskId, 'READY_FOR_PROMOTION', ts);
          emitTaskStage(eventAudienceTenantId, taskId, {
            stage: 'READY_FOR_PROMOTION',
            status: 'error',
            message: `Promoção não completou (${candidateResult.code}) — patch validado, mas não chegou ao repositório real.`,
            meta: candidateResult.evidence,
          });
          return { taskId, status: 'READY_FOR_PROMOTION', reasonCode: candidateResult.code };
        }

        emitTaskStage(eventAudienceTenantId, taskId, {
          stage: 'PROMOTION',
          status: 'success',
          message: `Candidate real criado: branch ${candidateResult.evidence.candidateBranch} (commit ${candidateResult.evidence.candidateCommit.slice(0, 12)}).`,
          meta: candidateResult.evidence,
        });

        // ER-V1-SEAL-002: POST_PROMOTION_VERIFY — o candidate já existe de verdade (efeito
        // irreversível já aconteceu); esta fase só confirma via smoke, nunca duplica nada.
        await enterAdvancePhase(taskId, 'POST_PROMOTION_VERIFY', currentStatusRef, ts);
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'POST_PROMOTION_VERIFY', status: 'running', message: 'Confirmando smoke pós-promoção em worktree novo a partir do candidate real.' });

        await held();
        const verifyOp = await operationService.beginOrReconcile({ taskId, attemptId, phase: 'POST_PROMOTION_VERIFY' });
        let verifyResult;
        if (verifyOp.action === 'RESUME') {
          verifyResult = { verified: true, ...verifyOp.operation.evidence_ref };
        } else {
          if (verifyOp.action === 'FAIL_SAFE') {
            throw Object.assign(new Error('POST_PROMOTION_VERIFY já está em execução em outro processo'), { code: 'OPERATION_STILL_RUNNING', phase: 'POST_PROMOTION_VERIFY' });
          }
          if (verifyOp.action === 'RECONCILE') {
            // Só leitura/execução em workspace descartável — seguro reexecutar sempre.
            await operationService.forceRun(verifyOp.operation.id, { reason: 'POST_PROMOTION_VERIFY não tem efeito colateral irreversível — seguro repetir' });
          }
          verifyResult = await verifyPromotedCandidate({
            taskId,
            attemptNumber: result.attempt.attempt_number,
            candidateCommit: candidateResult.evidence.candidateCommit,
            validatedTreeHash: candidateResult.evidence.validatedTreeHash,
            testCommands: task.test_commands || [],
          });
          if (verifyResult.verified) {
            await operationService.completeOperation(verifyOp.operation.id, { evidenceRef: verifyResult });
          } else {
            await operationService.failOperation(verifyOp.operation.id, { error: new Error(verifyResult.code || 'smoke pós-promoção falhou') });
          }
        }

        const createdAt = new Date().toISOString();
        const promotionEvidence = {
          ...candidateResult.evidence,
          postPromotionTreeHash: verifyResult.postPromotionTreeHash,
          createdAt,
          promotedAt: createdAt,
          promotionStatus: verifyResult.verified ? 'PROMOTED' : 'READY_FOR_PROMOTION',
          postPromotionTestPass: verifyResult.postPromotionTestPass,
          postPromotionResults: verifyResult.postPromotionResults,
        };
        // Achado real ao validar a tela de detalhe da task no browser: o motivo exato de uma
        // promoção não completada só existia no evento WebSocket ao vivo e no valor de retorno
        // — nunca era persistido junto com `promotion_evidence`. Mesclado aqui.
        await ts.updateAttempt(attemptId, {
          promotion_evidence: verifyResult.verified ? promotionEvidence : { ...promotionEvidence, code: verifyResult.code },
          promotion_status: verifyResult.verified ? 'PROMOTED' : 'READY_FOR_PROMOTION',
        });

        if (!verifyResult.verified) {
          // Nunca RED: CODER/TESTE/REVIEW/REGRESSION/GOVERNANCE passaram de verdade, e o
          // candidate JÁ EXISTE de verdade no git — só a verificação pós-promoção não
          // confirmou. READY_FOR_PROMOTION documenta exatamente por quê.
          await tolerantTransition(taskId, 'READY_FOR_PROMOTION', ts);
          emitTaskStage(eventAudienceTenantId, taskId, {
            stage: 'READY_FOR_PROMOTION',
            status: 'error',
            message: `Promoção não completou (${verifyResult.code}) — candidate real existe, mas a verificação pós-promoção não confirmou.`,
            meta: promotionEvidence,
          });
          return { taskId, status: 'READY_FOR_PROMOTION', reasonCode: verifyResult.code };
        }

        emitTaskStage(eventAudienceTenantId, taskId, {
          stage: 'PROMOTION',
          status: 'success',
          message: `Promovido: branch ${promotionEvidence.candidateBranch} (commit ${promotionEvidence.candidateCommit.slice(0, 12)}), smoke pós-promoção PASS.`,
          meta: promotionEvidence,
        });

        await recordProgress(run, 'promotion_completed', promotionEvidence.candidateBranch);

        // ==================================================================================
        // MISSION SOURCE AUTHORITY — INTEGRAÇÃO NA FONTE DA MISSÃO (o gap central)
        // ==================================================================================
        // O candidate existe e passou pelos gates. MAS ele nasceu numa branch isolada cujo pai é o
        // commit da FONTE DA MISSÃO. Enquanto esse commit não for integrado de volta à fonte, a
        // próxima task da missão não enxerga o patch — e o bug corrigido "reaparece" na replacement
        // task, não por ter voltado, mas por o fix nunca ter entrado no caminho de execução.
        //
        // Por isso a integração acontece ANTES do GREEN: a task só é declarada GREEN quando o seu
        // trabalho passou a fazer parte da realidade da missão. Integração recusada (stale,
        // pré-condição, concorrência, conflito) ⇒ a task fica READY_FOR_PROMOTION, com o código
        // exato da recusa persistido — nunca GREEN sobre trabalho que a missão não consegue usar.
        let missionIntegration = null;
        if (task.mission_id) {
          // PROVENIÊNCIA DO BUG FIX (finding → task → candidate → integração).
          // `integrateTaskCandidate` já aceitava `findingId` e a tabela já tinha `finding_id` /
          // `integration_type`, mas aqui o tipo era FIXO 'TASK_CANDIDATE' e o finding nunca era
          // passado: um candidate nascido de um bug encontrado autonomamente era integrado como
          // trabalho genérico, e a cadeia de causa ficava irrecuperável depois. O vínculo vive em
          // `fix_task_id` (gravado na triagem), então basta consultá-lo. A DECISÃO do que persistir
          // é pura e vive em `missionSource.resolveIntegrationProvenance`.
          let bugFinding = null;
          try {
            const bugFindingService = require('../engineeringMission/bugFindingService');
            bugFinding = await bugFindingService.findByFixTaskId(taskId);
          } catch (err) {
            // Fail-soft DELIBERADO: não achar o vínculo não pode impedir a integração (o trabalho é
            // real e passou pelos gates). O tipo apenas permanece o genérico, que é a verdade.
            bugFinding = null;
          }
          const { resolveIntegrationProvenance } = require('../../../engine/engineeringMission/missionSource');
          const provenance = resolveIntegrationProvenance(bugFinding);

          missionIntegration = await missionSourceService.integrateTaskCandidate({
            taskId,
            attemptId,
            candidateCommit: candidateResult.evidence.candidateCommit,
            findingId: provenance.findingId,
            integrationType: provenance.integrationType,
            // Posse vigente: quem integra é o dono do lease (o mesmo worker que promoveu).
            ownershipValid: Boolean(run && run.lease),
            // Integridade: o smoke pós-promoção confirmou que a árvore promovida é a árvore testada.
            candidateIntegrityOk: verifyResult.verified === true,
            candidateGreen: true,
            evidence: {
              candidateBranch: candidateResult.evidence.candidateBranch,
              validatedPatchHash: candidateResult.evidence.validatedPatchHash,
              postPromotionTestPass: verifyResult.postPromotionTestPass === true,
              promotionStatus: promotionEvidence.promotionStatus,
              isBugFix: provenance.isBugFix === true,
              ...provenance.evidence,
            },
          });

          if (!missionIntegration.integrated) {
            await ts.updateAttempt(attemptId, {
              promotion_evidence: { ...promotionEvidence, missionIntegration },
            });
            emitTaskStage(eventAudienceTenantId, taskId, {
              stage: 'READY_FOR_PROMOTION',
              status: 'error',
              message: `Candidate promovido, mas NÃO integrado na fonte da missão (${missionIntegration.code}): ${missionIntegration.reason}`,
              meta: { ...promotionEvidence, missionIntegration },
            });
            await tolerantTransition(taskId, 'READY_FOR_PROMOTION', ts);
            return { taskId, status: 'READY_FOR_PROMOTION', reasonCode: missionIntegration.code, missionIntegration };
          }

          await ts.updateAttempt(attemptId, {
            promotion_evidence: { ...promotionEvidence, missionIntegration },
          });
          emitTaskStage(eventAudienceTenantId, taskId, {
            stage: 'MISSION_SOURCE_INTEGRATION',
            status: 'success',
            message: `Fix integrado na fonte da missão ${missionIntegration.integrationBranch}: ${String(missionIntegration.missionCommitBefore).slice(0, 12)} → ${String(missionIntegration.missionCommitAfter).slice(0, 12)}. A próxima task nasce deste commit.`,
            meta: missionIntegration,
          });
          await recordProgress(run, 'mission_source_integrated', missionIntegration.missionCommitAfter);
        }

        await tolerantTransition(taskId, 'GREEN', ts);
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'GREEN', status: 'success', message: 'Task concluída com sucesso — patch promovido ao repositório real.' });
        return { taskId, status: 'GREEN', attemptId };
  } finally {
    if (result.workspace) await destroyWorkspace(result.workspace);
  }
}

// ER-V1-SEALFIX-004 — statuses de `EngineeringAttempt.status` que só existem ENQUANTO
// `runOneAttempt` está com a promise em voo (nunca sobrevivem a um retorno normal da função —
// toda saída de `runOneAttempt`, seja ADVANCE/RETRY/REROUTE/FATAL, deixa o attempt num status
// terminal-para-a-tentativa antes de retornar). Encontrar um destes ao recarregar do banco só
// pode significar uma coisa real: o PROCESSO morreu no meio de CODING/TESTING/REVIEWING.
const ATTEMPT_INFLIGHT_STATUSES = Object.freeze(['CODING', 'APPLIED', 'TESTED']);

/**
 * ER-V1-SEALFIX-004 (Phase-Aware Durable Resume) — chamado uma vez, no início de
 * `executeRoutedLoop`, ANTES de decidir criar uma tentativa nova. Nunca silencioso: toda
 * tentativa presa é marcada explicitamente (auditável), e toda retomada real passa pela MESMA
 * `advanceFromCodedAttempt`/`operationService` já usadas no caminho normal (nunca uma segunda
 * implementação paralela de "promover"/"rodar regressão"/etc.).
 *
 * @returns {Promise<object|null>} o resultado final da task (já formatado como o retorno
 *   público de `executeRoutedLoop`) se uma retomada real aconteceu, ou `null` se não havia nada
 *   para retomar (fluxo normal deve prosseguir para o `while` de novas tentativas).
 */
async function resumeAdvancePhaseIfNeeded(task, lastAttempt, { eventAudienceTenantId, run = null }) {
  const taskId = task.id;
  const ts = writesFor(run);
  if (!lastAttempt) return null;

  if (lastAttempt.status === 'DONE') {
    // CODING/TESTING/REVIEWING já terminaram com sucesso real (patch validado, testado,
    // aprovado) numa execução anterior deste MESMO attempt — a task só está aqui (não-terminal,
    // já passou pelo check de `acquireRunLock`) porque o processo morreu em algum ponto de
    // REGRESSION/GOVERNANCE/PROMOTING/POST_PROMOTION_VERIFY antes de a task chegar a um estado
    // terminal. Nunca cria uma tentativa nova redundante — retoma exatamente daqui.
    let workspace = lastAttempt.workspace_path;
    const diff = lastAttempt.patch_diff;
    if (!diff) {
      // Estado real impossível pela lógica de `runOneAttempt` (DONE só é setado depois de
      // `patch_diff` já persistido), mas nunca assume — se acontecer, é auditável, nunca uma
      // promoção silenciosa sobre dado incompleto.
      await ts.saveLastError(taskId, { code: 'RESUME_MISSING_PATCH_DIFF', message: `Tentativa ${lastAttempt.id} está DONE mas sem patch_diff persistido — retomada não é segura.` });
      await ts.transitionTask(taskId, 'BLOCKED');
      emitTaskStage(eventAudienceTenantId, taskId, { stage: 'BLOCKED', status: 'error', message: 'Retomada bloqueada: tentativa concluída sem patch persistido (estado inconsistente, nunca assumido).' });
      return { taskId, status: 'BLOCKED', reasonCode: 'RESUME_MISSING_PATCH_DIFF' };
    }
    if (!workspace || !fs.existsSync(workspace)) {
      // Workspace efêmero pode não sobreviver a um restart real (tmpdir limpo, container
      // reiniciado) — SEAL-001 garante que HEAD é real e imutável, então reaplicar o MESMO
      // diff persistido sobre um workspace novo produz a MESMA tree, determinístico.
      try {
        workspace = await createWorkspace(taskId, lastAttempt.attempt_number);
        const applyResult = await applyPatch(workspace, diff);
        if (!applyResult.ok) {
          await ts.saveLastError(taskId, { code: 'RESUME_WORKSPACE_RECONSTRUCTION_FAILED', message: applyResult.stderr || applyResult.code });
          await ts.transitionTask(taskId, 'BLOCKED');
          emitTaskStage(eventAudienceTenantId, taskId, { stage: 'BLOCKED', status: 'error', message: `Retomada bloqueada: não foi possível reconstruir o workspace a partir do patch já validado (${applyResult.code}).` });
          return { taskId, status: 'BLOCKED', reasonCode: 'RESUME_WORKSPACE_RECONSTRUCTION_FAILED' };
        }
      } catch (err) {
        await ts.saveLastError(taskId, { code: 'RESUME_WORKSPACE_RECONSTRUCTION_FAILED', message: err.message });
        await ts.transitionTask(taskId, 'BLOCKED');
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'BLOCKED', status: 'error', message: `Retomada bloqueada: falha real ao reconstruir workspace (${err.message}).` });
        return { taskId, status: 'BLOCKED', reasonCode: 'RESUME_WORKSPACE_RECONSTRUCTION_FAILED' };
      }
    }
    logger.info('[engineeringRouterService] retomando fase pós-CODE após reinício de processo', { taskId, attemptId: lastAttempt.id, taskStatus: task.status });
    emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RESUME', status: 'info', message: `Retomando a partir de ${task.status} após reinício — patch já validado, nunca uma nova tentativa de CODER.` });
    return advanceFromCodedAttempt(task, { attempt: lastAttempt, diff, workspace }, { eventAudienceTenantId, run });
  }

  if (ATTEMPT_INFLIGHT_STATUSES.includes(lastAttempt.status)) {
    // Processo morreu com a tentativa em voo dentro de CODING/TESTING/REVIEWING — nenhum efeito
    // colateral IRREVERSÍVEL pode ter acontecido ainda nessas fases (nenhuma promoção, nenhum
    // commit real), então nunca é inseguro simplesmente abandonar esta tentativa e deixar o
    // `while` normal criar uma nova — mas NUNCA em silêncio: marcada explicitamente, auditável.
    await ts.updateAttempt(lastAttempt.id, {
      status: 'ABANDONED',
      error: { code: 'RESUME_ABANDONED_INCOMPLETE_PHASE', message: `Processo reiniciado com a tentativa presa em status=${lastAttempt.status} (task.status=${task.status}) — nenhum efeito irreversível nesta fase, tentativa marcada como abandonada e uma nova será criada.` },
      completed_at: new Date(),
    });
    logger.warn('[engineeringRouterService] tentativa anterior abandonada após reinício de processo (fase sem efeito irreversível)', { taskId, attemptId: lastAttempt.id, attemptStatus: lastAttempt.status });
    emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RESUME', status: 'info', message: `Tentativa anterior (status=${lastAttempt.status}) abandonada após reinício — iniciando nova tentativa.` });
  }

  return null;
}

module.exports = {
  ENGINEERING_CREDENTIAL_SCOPE,
  ensureRouted,
  runOneAttempt,
  runTask,
  beginRun,
  tolerantTransition,
  // ER-V1-SEALFIX-004 — exportados para o teste E2E de crash/restart poder simular o estado
  // exato que um processo real teria persistido antes de morrer, e verificar a retomada real
  // via a mesma função pública (`runTask`) — nunca uma segunda implementação paralela de teste.
  advanceFromCodedAttempt,
  resumeAdvancePhaseIfNeeded,
  ADVANCE_PHASE_ORDER,
};
