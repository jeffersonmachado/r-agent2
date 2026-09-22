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
const { FAILURE_CODES, TERMINAL_STATES } = require('../../../engine/engineeringRouter/constants');
const { emitTaskStage } = require('./engineeringRouterEvents');
const logger = require('../../utils/logger');

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
async function tolerantTransition(taskId, toStatus) {
  try {
    return await engineeringTaskService.transitionTask(taskId, toStatus);
  } catch (err) {
    if (err.code !== FAILURE_CODES.INVALID_STATE_TRANSITION) throw err;

    const current = await engineeringTaskService.getTask(taskId);
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
async function ensureRouted(task, { credentialScope, eventAudienceTenantId }) {
  if (task.status !== 'CLASSIFIED') return task;

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

  await engineeringTaskService.saveRoutingDecision(task.id, routingDecision);
  const routedTask = await engineeringTaskService.transitionTask(task.id, 'ROUTED');
  emitTaskStage(eventAudienceTenantId, task.id, {
    stage: 'ROUTED',
    status: 'success',
    message: `CODER ${routingDecision.coder?.selected ? `${routingDecision.coder.selected.providerId}:${routingDecision.coder.selected.modelId}` : 'nenhum qualificado'} · REVIEWER ${routingDecision.reviewer?.selected ? `${routingDecision.reviewer.selected.providerId}:${routingDecision.reviewer.selected.modelId}` : 'nenhum qualificado'}`,
    meta: { routingDecision },
  });
  return routedTask;
}

/** Um attempt completo: CODE → PATCH VALIDATE → APPLY → TEST → REVIEW. */
async function runOneAttempt({ task, routingDecision, failureBundle, previousAttempt, credentialScope, eventAudienceTenantId }) {
  const coderSelection = routingDecision?.coder?.selected;
  if (!coderSelection) {
    return { outcome: 'FATAL', reasonCode: 'NO_QUALIFIED_CODER' };
  }

  await tolerantTransition(task.id, 'CODING');

  const attempt = await engineeringTaskService.createAttempt(task.id, {
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
  await engineeringTaskService.updateAttempt(attempt.id, { context_summary: { includedFiles: context.includedFiles, blockedFiles: context.blockedFiles, skippedFiles: context.skippedFiles, budget: context.budget } });

  let patchResult;
  const telemetryBase = { task_id: task.id, attempt_id: attempt.id, role: 'CODER', provider: coderSelection.providerId, model: coderSelection.modelId };
  try {
    patchResult = await generatePatch({ context, providerId: coderSelection.providerId, modelId: coderSelection.modelId, tenantId: credentialScope });
  } catch (err) {
    await engineeringTaskService.recordTelemetry({
      ...telemetryBase,
      input_tokens: err.usage?.prompt_tokens ?? null,
      output_tokens: err.usage?.completion_tokens ?? null,
      latency_ms: err.latencyMs ?? null,
      result: 'FAILURE',
    });
    await engineeringTaskService.updateAttempt(attempt.id, { status: 'FAILED', error: { code: err.code, message: err.message }, completed_at: new Date() });
    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'CODING',
      status: 'error',
      attemptNumber: attempt.attempt_number,
      message: `CODER falhou: ${err.message}`,
      meta: { code: err.code },
    });
    if (err.code === FAILURE_CODES.PROVIDER_UNAVAILABLE) {
      // ERV1-CLOSE-008: provider saudável não implica que ESTE modelo funcione (ex.: 404
      // "modelo não existe"). Marca o modelo específico e sinaliza reroute em vez de derrubar a
      // task inteira de cara — o orquestrador tenta o próximo candidato qualificado antes de
      // desistir.
      const classified = modelAvailabilityStore.classifyModelFailure(err);
      modelAvailabilityStore.markUnavailable(coderSelection.providerId, coderSelection.modelId, classified);
      return {
        outcome: 'REROUTE',
        role: 'CODER',
        failedModelKey: `${coderSelection.providerId}:${coderSelection.modelId}`,
        reasonCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
        attempt,
      };
    }
    return { outcome: 'RETRY', failureBundle: { failedCommand: 'CODER_GENERATION', stderr: err.message, code: err.code }, attempt };
  }
  modelAvailabilityStore.markAvailable(coderSelection.providerId, coderSelection.modelId);

  await engineeringTaskService.recordTelemetry({
    ...telemetryBase,
    input_tokens: patchResult.usage?.prompt_tokens ?? null,
    output_tokens: patchResult.usage?.completion_tokens ?? null,
    latency_ms: patchResult.latencyMs,
    result: 'SUCCESS',
  });

  const validation = validatePatch(patchResult.diff, { contract: contractFromTask(task) });
  await engineeringTaskService.updateAttempt(attempt.id, { patch_diff: patchResult.diff, patch_validation: validation });

  if (!validation.ok) {
    await engineeringTaskService.updateAttempt(attempt.id, { status: 'PATCH_REJECTED', completed_at: new Date() });
    return { outcome: 'RETRY', failureBundle: { failedCommand: 'PATCH_VALIDATION', issues: validation.issues, code: validation.code }, attempt };
  }

  let workspace = null;
  let keepWorkspace = false;
  try {
    workspace = await createWorkspace(task.id, attempt.attempt_number);
    await engineeringTaskService.updateAttempt(attempt.id, { workspace_path: workspace });

    const applyResult = await applyPatch(workspace, patchResult.diff);
    if (!applyResult.ok) {
      await engineeringTaskService.updateAttempt(attempt.id, { status: 'FAILED', error: { code: applyResult.code, stderr: applyResult.stderr }, completed_at: new Date() });
      emitTaskStage(eventAudienceTenantId, task.id, {
        stage: 'PATCH_APPLY',
        status: 'error',
        attemptNumber: attempt.attempt_number,
        message: `Falha ao aplicar patch: ${applyResult.code}`,
        meta: { stderr: applyResult.stderr },
      });
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'PATCH_APPLY', stderr: applyResult.stderr, code: applyResult.code }, attempt };
    }

    await engineeringTaskService.updateAttempt(attempt.id, { status: 'APPLIED' });
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

    await tolerantTransition(task.id, 'TESTING');

    const testCommands = task.test_commands || [];
    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'TESTING',
      status: 'running',
      attemptNumber: attempt.attempt_number,
      message: testCommands.length ? `Rodando ${testCommands.length} comando(s) de teste…` : 'Nenhum testCommand definido.',
      meta: { commands: testCommands },
    });
    const testResult = await runTestCommands({ taskId: task.id, attemptNumber: attempt.attempt_number, commands: testCommands, cwd: workspace });

    for (const r of testResult.results) {
      await engineeringTaskService.createTestRun(attempt.id, {
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
      await engineeringTaskService.updateAttempt(attempt.id, { status: 'FAILED', error: { code: 'NO_TEST_COMMANDS' }, completed_at: new Date() });
      emitTaskStage(eventAudienceTenantId, task.id, { stage: 'TESTING', status: 'error', attemptNumber: attempt.attempt_number, message: 'Nenhum testCommand definido — não há como validar o patch.' });
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'TEST_STAGE', stderr: 'Task Contract não define testCommands — nenhum teste determinístico para validar o patch.' }, attempt };
    }

    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'TEST_RESULT',
      status: testResult.allPass ? 'success' : 'error',
      attemptNumber: attempt.attempt_number,
      message: testResult.allPass ? 'Todos os testes passaram.' : 'Ao menos um teste falhou.',
      meta: { results: testResult.results.map((r) => ({ command: r.command, status: r.status, exitCode: r.exitCode })) },
    });

    if (!testResult.allPass) {
      const failed = testResult.results.find((r) => r.status !== 'PASS');
      await engineeringTaskService.updateAttempt(attempt.id, { status: 'FAILED', completed_at: new Date() });
      return {
        outcome: 'RETRY',
        failureBundle: {
          failedCommand: failed.command,
          exitCode: failed.exitCode,
          stderr: failed.stderrExcerpt || failed.reason,
          failedTests: [],
        },
        attempt,
      };
    }

    await engineeringTaskService.updateAttempt(attempt.id, { status: 'TESTED' });
    await tolerantTransition(task.id, 'REVIEWING');

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
    try {
      reviewResult = await review({
        task: context.task,
        diff: patchResult.diff,
        testEvidence: testResult,
        contextFiles: context.files,
        providerId: reviewerSelection.providerId,
        modelId: reviewerSelection.modelId,
        tenantId: credentialScope,
      });
    } catch (err) {
      await engineeringTaskService.recordTelemetry({ ...reviewTelemetryBase, result: 'FAILURE', test_pass: true });
      emitTaskStage(eventAudienceTenantId, task.id, {
        stage: 'REVIEWING',
        status: 'error',
        attemptNumber: attempt.attempt_number,
        message: `Reviewer falhou: ${err.message}`,
        meta: { code: err.code },
      });
      if (err.code === FAILURE_CODES.PROVIDER_UNAVAILABLE) {
        const classified = modelAvailabilityStore.classifyModelFailure(err);
        modelAvailabilityStore.markUnavailable(reviewerSelection.providerId, reviewerSelection.modelId, classified);
        return {
          outcome: 'REROUTE',
          role: 'REVIEWER',
          failedModelKey: `${reviewerSelection.providerId}:${reviewerSelection.modelId}`,
          reasonCode: FAILURE_CODES.PROVIDER_UNAVAILABLE,
          attempt,
        };
      }
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'REVIEW_STAGE', stderr: err.message }, attempt };
    }
    modelAvailabilityStore.markAvailable(reviewerSelection.providerId, reviewerSelection.modelId);

    await engineeringTaskService.recordTelemetry({
      ...reviewTelemetryBase,
      input_tokens: reviewResult.usage?.prompt_tokens ?? null,
      output_tokens: reviewResult.usage?.completion_tokens ?? null,
      latency_ms: reviewResult.latencyMs,
      result: 'SUCCESS',
      test_pass: true,
      review_result: reviewResult.decision,
    });

    await engineeringTaskService.createReview(attempt.id, {
      reviewer_provider: reviewerSelection.providerId,
      reviewer_model: reviewerSelection.modelId,
      decision: reviewResult.decision,
      findings: reviewResult.findings,
      independent_of_coder: routingDecision.independentReviewApplied,
    });

    emitTaskStage(eventAudienceTenantId, task.id, {
      stage: 'REVIEW_DECISION',
      status: reviewResult.decision === 'APPROVE' ? 'success' : 'error',
      attemptNumber: attempt.attempt_number,
      message: `${reviewResult.decision} — ${reviewerSelection.providerId}:${reviewerSelection.modelId}${routingDecision.independentReviewApplied ? ' (independente)' : ''}`,
      meta: { decision: reviewResult.decision, findings: reviewResult.findings },
    });

    if (reviewResult.decision === 'REJECT') {
      const blocking = reviewResult.findings.filter((f) => f.severity === 'BLOCKER' || f.severity === 'REGRESSION');
      await engineeringTaskService.updateAttempt(attempt.id, { status: 'FAILED', completed_at: new Date() });
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'REVIEW', findings: blocking }, attempt };
    }

    await engineeringTaskService.updateAttempt(attempt.id, { status: 'DONE', completed_at: new Date() });
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
async function acquireRunLock(taskId, runnerId) {
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

  await engineeringTaskService.lockForRun(taskId, runnerId);
  return { task, alreadyTerminal: false };
}

async function runLockedTask(task, { credentialScope, eventAudienceTenantId }) {
  const taskId = task.id;
  try {
    return await executeRoutedLoop(task, { credentialScope, eventAudienceTenantId });
  } catch (err) {
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
    await engineeringTaskService.unlockTask(taskId);
  }
}

async function runTask(taskId, {
  runnerId = `runner-${process.pid}-${Date.now()}`,
  credentialScope = ENGINEERING_CREDENTIAL_SCOPE,
  eventAudienceTenantId = null,
} = {}) {
  const { task, alreadyTerminal } = await acquireRunLock(taskId, runnerId);
  if (alreadyTerminal) return { taskId, status: task.status, idempotent: true };

  // Sem audiência explícita (ex.: worker de background sem requisição HTTP associada), o
  // evento cai no próprio credentialScope — mesmo default de sempre para quem não pediu uma
  // audiência específica. Nunca o inverso (nunca derivar credentialScope da audiência).
  const resolvedAudience = eventAudienceTenantId || credentialScope;
  return runLockedTask(task, { credentialScope, eventAudienceTenantId: resolvedAudience });
}

/**
 * ERV1-CLOSE-009: variante para a camada HTTP. Adquire o lock de forma SÍNCRONA (awaited) —
 * uma segunda chamada concorrente genuína recebe `TASK_ALREADY_RUNNING` aqui, antes de qualquer
 * resposta HTTP ser enviada — e só então dispara o loop de execução (que pode envolver várias
 * chamadas de LLM/testes reais) em background. Nunca use isto para aguardar o resultado final;
 * é só para tornar a resposta 202/409 honesta sobre se a execução realmente começou.
 *
 * @returns {Promise<{taskId:string, status:string, accepted:boolean}>}
 */
async function beginRun(taskId, {
  runnerId = `runner-${process.pid}-${Date.now()}`,
  credentialScope = ENGINEERING_CREDENTIAL_SCOPE,
  eventAudienceTenantId = null,
} = {}) {
  const { task, alreadyTerminal } = await acquireRunLock(taskId, runnerId);
  if (alreadyTerminal) return { taskId, status: task.status, accepted: false };

  const resolvedAudience = eventAudienceTenantId || credentialScope;
  // Fire-and-forget de propósito: o lock já foi adquirido de verdade acima (síncrono); o que
  // resta (chamadas de LLM, testes reais) pode legitimamente exceder o timeout de uma
  // requisição HTTP.
  runLockedTask(task, { credentialScope, eventAudienceTenantId: resolvedAudience })
    .catch((err) => logger.error('[engineeringRouterService] beginRun: execução em background falhou', { taskId, error: err.message, code: err.code }));

  return { taskId, status: 'ACCEPTED', accepted: true };
}

async function executeRoutedLoop(task, { credentialScope, eventAudienceTenantId }) {
  const taskId = task.id;
  task = await ensureRouted(task, { credentialScope, eventAudienceTenantId });

  if (!task.routing_decision?.coder?.selected) {
    await engineeringTaskService.saveLastError(taskId, { code: 'NO_QUALIFIED_CODER', message: 'Nenhum CODER qualificado disponível' });
    await engineeringTaskService.transitionTask(taskId, 'RED');
    emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: 'Nenhum CODER qualificado disponível.' });
    return { taskId, status: 'RED', reasonCode: 'NO_QUALIFIED_CODER' };
  }

  const existingAttempts = await engineeringTaskService.listAttempts(taskId);
  let iterationsUsed = existingAttempts.length;
  let failureBundle = null;
  const lastAttempt = existingAttempts[existingAttempts.length - 1] || null;
  if (lastAttempt && lastAttempt.failure_bundle) failureBundle = lastAttempt.failure_bundle;

  // ERV1-CLOSE-008: acumula, para esta execução da task, todo modelo que já falhou por
  // indisponibilidade real — nunca reselecionar o mesmo candidato quebrado num reroute
  // seguinte dentro da mesma task.
  const excludedModelKeys = new Set();

  while (iterationsUsed < task.max_iterations) {
    const result = await runOneAttempt({ task, routingDecision: task.routing_decision, failureBundle, previousAttempt: lastAttempt, credentialScope, eventAudienceTenantId });
    iterationsUsed += 1;

    if (result.outcome === 'FATAL') {
      await engineeringTaskService.saveLastError(taskId, { code: result.reasonCode, message: `Falha fatal: ${result.reasonCode}` });
      await engineeringTaskService.transitionTask(taskId, 'RED');
      emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: `Falha fatal: ${result.reasonCode}` });
      return { taskId, status: 'RED', reasonCode: result.reasonCode };
    }

    if (result.outcome === 'REROUTE') {
      excludedModelKeys.add(result.failedModelKey);
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
        await engineeringTaskService.saveLastError(taskId, {
          code: FAILURE_CODES.NO_ALTERNATIVE_CANDIDATE,
          message: `Nenhum ${result.role} alternativo disponível após ${result.failedModelKey} falhar (${result.reasonCode})`,
        });
        await engineeringTaskService.transitionTask(taskId, 'RED');
        emitTaskStage(eventAudienceTenantId, taskId, {
          stage: 'RED',
          status: 'error',
          message: `Nenhum ${result.role} alternativo qualificado após ${result.failedModelKey} falhar.`,
        });
        return { taskId, status: 'RED', reasonCode: FAILURE_CODES.NO_ALTERNATIVE_CANDIDATE };
      }

      await engineeringTaskService.saveRoutingDecision(taskId, newRoutingDecision);
      task = { ...task, routing_decision: newRoutingDecision };
      const newSelection = result.role === 'CODER' ? newRoutingDecision.coder.selected : newRoutingDecision.reviewer.selected;
      emitTaskStage(eventAudienceTenantId, taskId, {
        stage: 'REROUTE',
        status: 'info',
        message: `${result.failedModelKey} indisponível — reroteado para ${newSelection.providerId}:${newSelection.modelId} (${result.role}).`,
        meta: { failedModelKey: result.failedModelKey, role: result.role, reasonCode: result.reasonCode },
      });
      failureBundle = { failedCommand: `${result.role}_REROUTE`, stderr: `${result.failedModelKey} indisponível (${result.reasonCode})` };
      logger.info('[engineeringRouterService] reroute de modelo', { taskId, role: result.role, failedModelKey: result.failedModelKey });
      continue;
    }

    if (result.outcome === 'ADVANCE') {
      // ERV1-CLOSE-005: `runOneAttempt` deliberadamente NÃO destrói o workspace num ADVANCE —
      // a Promotion precisa dele (tree pós-patch) mais abaixo. Esta função assume a
      // responsabilidade de destruí-lo, em QUALQUER saída deste bloco (RED de regressão/
      // governança, READY_FOR_PROMOTION, ou GREEN).
      const attemptId = result.attempt.id;
      try {
        await tolerantTransition(taskId, 'REGRESSION');
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'REGRESSION', status: 'running', message: 'Executando RegressionPlan real (proporcional ao risco) em workspace isolado.' });

        // ER-V1-SEAL-002 (Full Durable Resume): REGRESSION nunca tem efeito colateral externo
        // irreversível (só executa comandos e persiste evidência) — um RUNNING órfão (crash no
        // meio) é seguro reexecutar do zero. RESUME reusa a evidência já persistida sem rodar
        // os comandos de novo; FAIL_SAFE nunca roda concorrentemente com outra execução real.
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
          regressionResult = await checkRegression({
            taskId,
            attemptId,
            workspacePath: result.workspace,
            touchedPaths,
            risk: task.risk,
            targetedCommands: task.test_commands || [],
          });
          if (regressionResult.pass) {
            await operationService.completeOperation(regressionOp.operation.id, { evidenceRef: regressionResult.evidence });
          } else {
            await operationService.failOperation(regressionOp.operation.id, { error: new Error('regressão reprovou') });
          }
        }
        await engineeringTaskService.updateAttempt(attemptId, { regression_evidence: regressionResult.evidence });
        if (!regressionResult.pass) {
          await engineeringTaskService.saveLastError(taskId, { code: FAILURE_CODES.REGRESSION_FAILED, message: 'Regressão real reprovou após review aprovar', evidence: regressionResult.evidence });
          await tolerantTransition(taskId, 'RED');
          emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: 'Regressão reprovou — nunca GREEN sem evidência real.', meta: regressionResult.evidence });
          return { taskId, status: 'RED', reasonCode: FAILURE_CODES.REGRESSION_FAILED };
        }
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'REGRESSION', status: 'success', message: `Regressão real: ${regressionResult.evidence.commandCount || 0} comando(s) PASS.`, meta: regressionResult.evidence });

        await tolerantTransition(taskId, 'GOVERNANCE');
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'GOVERNANCE', status: 'running', message: 'Executando gate de governança real (scripts/governance/validate-engineering-router-v1.js).' });

        // Mesma lógica de reconciliação de REGRESSION — GOVERNANCE também não tem efeito
        // colateral externo irreversível.
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
          governanceResult = await checkGovernance();
          if (governanceResult.pass) {
            await operationService.completeOperation(governanceOp.operation.id, { evidenceRef: governanceResult.evidence });
          } else {
            await operationService.failOperation(governanceOp.operation.id, { error: new Error('gate de governança reprovou') });
          }
        }
        await engineeringTaskService.updateAttempt(attemptId, { governance_evidence: governanceResult.evidence });
        if (!governanceResult.pass) {
          await engineeringTaskService.saveLastError(taskId, { code: FAILURE_CODES.GOVERNANCE_FAILED, message: 'Gate de governança real reprovou', evidence: governanceResult.evidence });
          await tolerantTransition(taskId, 'RED');
          emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: 'Governance reprovou — nunca GREEN sem o gate real passando.', meta: governanceResult.evidence });
          return { taskId, status: 'RED', reasonCode: FAILURE_CODES.GOVERNANCE_FAILED };
        }
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'GOVERNANCE', status: 'success', message: 'Gate de governança real: PASS.', meta: governanceResult.evidence });

        // ER-V1-SEAL-002: PROMOTING é o ponto MAIS crítico — `createPromotionCandidate` tem
        // efeito real e IRREVERSÍVEL (commit + branch reais). Um RUNNING órfão aqui NUNCA pode
        // ser tratado como "seguro repetir" sem antes checar evidência EXTERNA real (a branch
        // candidata já existe?) — nunca promover duas vezes por crash.
        await tolerantTransition(taskId, 'PROMOTING');
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'PROMOTION', status: 'running', message: 'Promovendo patch validado (commit + branch local dedicada, sem push/merge).' });

        const validatedPatchHashForReconcile = computeValidatedPatchHash(result.diff);
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
          await engineeringTaskService.updateAttempt(attemptId, {
            promotion_evidence: { ...candidateResult.evidence, code: candidateResult.code },
            promotion_status: 'READY_FOR_PROMOTION',
          });
          await tolerantTransition(taskId, 'READY_FOR_PROMOTION');
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
        await tolerantTransition(taskId, 'POST_PROMOTION_VERIFY');
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'POST_PROMOTION_VERIFY', status: 'running', message: 'Confirmando smoke pós-promoção em worktree novo a partir do candidate real.' });

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
        await engineeringTaskService.updateAttempt(attemptId, {
          promotion_evidence: verifyResult.verified ? promotionEvidence : { ...promotionEvidence, code: verifyResult.code },
          promotion_status: verifyResult.verified ? 'PROMOTED' : 'READY_FOR_PROMOTION',
        });

        if (!verifyResult.verified) {
          // Nunca RED: CODER/TESTE/REVIEW/REGRESSION/GOVERNANCE passaram de verdade, e o
          // candidate JÁ EXISTE de verdade no git — só a verificação pós-promoção não
          // confirmou. READY_FOR_PROMOTION documenta exatamente por quê.
          await tolerantTransition(taskId, 'READY_FOR_PROMOTION');
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

        await tolerantTransition(taskId, 'GREEN');
        emitTaskStage(eventAudienceTenantId, taskId, { stage: 'GREEN', status: 'success', message: 'Task concluída com sucesso — patch promovido ao repositório real.' });
        return { taskId, status: 'GREEN', attemptId };
      } finally {
        if (result.workspace) await destroyWorkspace(result.workspace);
      }
    }

    // RETRY
    failureBundle = result.failureBundle;
    emitTaskStage(eventAudienceTenantId, taskId, {
      stage: 'RETRY',
      status: 'info',
      message: `Tentativa ${iterationsUsed}/${task.max_iterations} falhou (${failureBundle?.failedCommand || 'motivo desconhecido'}) — iniciando nova tentativa.`,
    });
    logger.info('[engineeringRouterService] RED->FIX: nova tentativa', { taskId, iterationsUsed, reason: failureBundle?.failedCommand });
  }

  await engineeringTaskService.saveLastError(taskId, { code: FAILURE_CODES.ENGINEERING_TASK_EXHAUSTED, message: `Esgotadas ${task.max_iterations} tentativas` });
  await engineeringTaskService.transitionTask(taskId, 'RED');
  emitTaskStage(eventAudienceTenantId, taskId, { stage: 'RED', status: 'error', message: `Esgotadas ${task.max_iterations} tentativas.` });
  return { taskId, status: 'RED', reasonCode: FAILURE_CODES.ENGINEERING_TASK_EXHAUSTED };
}

module.exports = {
  ENGINEERING_CREDENTIAL_SCOPE,
  ensureRouted,
  runOneAttempt,
  runTask,
  beginRun,
  tolerantTransition,
};
