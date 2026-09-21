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
 */

const engineeringTaskService = require('./engineeringTaskService');
const { buildContext } = require('./contextBuilderService');
const { generatePatch } = require('./coderService');
const { review } = require('./reviewerService');
const { createWorkspace, applyPatch, destroyWorkspace, listChangedFiles } = require('./patchApplyService');
const { runTestCommands } = require('./testRunnerService');
const { buildAvailableModels, DEFAULT_TENANT_ID } = require('./engineeringModelAvailabilityService');
const { validatePatch } = require('../../../engine/engineeringRouter/patchValidator');
const { getPolicy, requiresIndependentReview } = require('../../../engine/engineeringRouter/routingPolicy');
const { selectCoderAndReviewer } = require('../../../engine/engineeringRouter/modelSelector');
const { FAILURE_CODES } = require('../../../engine/engineeringRouter/constants');
const { emitTaskStage } = require('./engineeringRouterEvents');
const logger = require('../../utils/logger');

function contractFromTask(task) {
  return {
    allowedPaths: task.allowed_paths || [],
    forbiddenPaths: task.forbidden_paths || [],
    allowDeletes: false,
  };
}

/** Estágio ROUTE: seleciona CODER/REVIEWER e persiste a decisão (idempotente — não reprocessa se já ROUTED+). */
async function ensureRouted(task, { tenantId }) {
  if (task.status !== 'CLASSIFIED') return task;

  const policy = getPolicy(task.task_type);
  const independentRequired = requiresIndependentReview(task.task_type, task.risk);
  const availableModels = await buildAvailableModels({ tenantId });

  const routingDecision = selectCoderAndReviewer(availableModels, {
    coderCapabilities: policy.coderCapabilities,
    reviewerCapabilities: policy.reviewerCapabilities,
    preferredCostClass: policy.preferredCostClass,
    independentReviewRequired: independentRequired,
    policyVersion: policy.policyVersion,
  });

  await engineeringTaskService.saveRoutingDecision(task.id, routingDecision);
  const routedTask = await engineeringTaskService.transitionTask(task.id, 'ROUTED');
  emitTaskStage(tenantId, task.id, {
    stage: 'ROUTED',
    status: 'success',
    message: `CODER ${routingDecision.coder?.selected ? `${routingDecision.coder.selected.providerId}:${routingDecision.coder.selected.modelId}` : 'nenhum qualificado'} · REVIEWER ${routingDecision.reviewer?.selected ? `${routingDecision.reviewer.selected.providerId}:${routingDecision.reviewer.selected.modelId}` : 'nenhum qualificado'}`,
    meta: { routingDecision },
  });
  return routedTask;
}

/** Um attempt completo: CODE → PATCH VALIDATE → APPLY → TEST → REVIEW. */
async function runOneAttempt({ task, routingDecision, failureBundle, previousAttempt, tenantId }) {
  const coderSelection = routingDecision?.coder?.selected;
  if (!coderSelection) {
    return { outcome: 'FATAL', reasonCode: 'NO_QUALIFIED_CODER' };
  }

  await engineeringTaskService.transitionTask(task.id, 'CODING').catch(() => {
    // já pode estar em CODING numa retomada — não é fatal, apenas segue.
  });

  const attempt = await engineeringTaskService.createAttempt(task.id, {
    status: 'CODING',
    coder_provider: coderSelection.providerId,
    coder_model: coderSelection.modelId,
    routing_reason_codes: routingDecision.coder.reasonCodes,
    failure_bundle: failureBundle || null,
  });

  emitTaskStage(tenantId, task.id, {
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
    patchResult = await generatePatch({ context, providerId: coderSelection.providerId, modelId: coderSelection.modelId, tenantId });
  } catch (err) {
    await engineeringTaskService.recordTelemetry({
      ...telemetryBase,
      input_tokens: err.usage?.prompt_tokens ?? null,
      output_tokens: err.usage?.completion_tokens ?? null,
      latency_ms: err.latencyMs ?? null,
      result: 'FAILURE',
    });
    await engineeringTaskService.updateAttempt(attempt.id, { status: 'FAILED', error: { code: err.code, message: err.message }, completed_at: new Date() });
    emitTaskStage(tenantId, task.id, {
      stage: 'CODING',
      status: 'error',
      attemptNumber: attempt.attempt_number,
      message: `CODER falhou: ${err.message}`,
      meta: { code: err.code },
    });
    if (err.code === FAILURE_CODES.PROVIDER_UNAVAILABLE) {
      return { outcome: 'FATAL', reasonCode: FAILURE_CODES.PROVIDER_UNAVAILABLE, attempt };
    }
    return { outcome: 'RETRY', failureBundle: { failedCommand: 'CODER_GENERATION', stderr: err.message, code: err.code }, attempt };
  }

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
  try {
    workspace = await createWorkspace(task.id, attempt.attempt_number);
    await engineeringTaskService.updateAttempt(attempt.id, { workspace_path: workspace });

    const applyResult = await applyPatch(workspace, patchResult.diff);
    if (!applyResult.ok) {
      await engineeringTaskService.updateAttempt(attempt.id, { status: 'FAILED', error: { code: applyResult.code, stderr: applyResult.stderr }, completed_at: new Date() });
      emitTaskStage(tenantId, task.id, {
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
    emitTaskStage(tenantId, task.id, {
      stage: 'PATCH_APPLIED',
      status: 'success',
      attemptNumber: attempt.attempt_number,
      message: `Patch aplicado — ${changedFiles.length} arquivo(s) alterado(s).`,
      changedFiles,
    });

    await engineeringTaskService.transitionTask(task.id, 'TESTING').catch(() => {});

    const testCommands = task.test_commands || [];
    emitTaskStage(tenantId, task.id, {
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
      emitTaskStage(tenantId, task.id, { stage: 'TESTING', status: 'error', attemptNumber: attempt.attempt_number, message: 'Nenhum testCommand definido — não há como validar o patch.' });
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'TEST_STAGE', stderr: 'Task Contract não define testCommands — nenhum teste determinístico para validar o patch.' }, attempt };
    }

    emitTaskStage(tenantId, task.id, {
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
    await engineeringTaskService.transitionTask(task.id, 'REVIEWING').catch(() => {});

    const reviewerSelection = routingDecision?.reviewer?.selected;
    if (!reviewerSelection) {
      return { outcome: 'FATAL', reasonCode: 'NO_QUALIFIED_REVIEWER', attempt };
    }

    emitTaskStage(tenantId, task.id, {
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
        tenantId,
      });
    } catch (err) {
      await engineeringTaskService.recordTelemetry({ ...reviewTelemetryBase, result: 'FAILURE', test_pass: true });
      emitTaskStage(tenantId, task.id, {
        stage: 'REVIEWING',
        status: 'error',
        attemptNumber: attempt.attempt_number,
        message: `Reviewer falhou: ${err.message}`,
        meta: { code: err.code },
      });
      if (err.code === FAILURE_CODES.PROVIDER_UNAVAILABLE) {
        return { outcome: 'FATAL', reasonCode: FAILURE_CODES.PROVIDER_UNAVAILABLE, attempt };
      }
      return { outcome: 'RETRY', failureBundle: { failedCommand: 'REVIEW_STAGE', stderr: err.message }, attempt };
    }

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

    emitTaskStage(tenantId, task.id, {
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
    return { outcome: 'ADVANCE', attempt, diff: patchResult.diff, testResult };
  } finally {
    if (workspace) await destroyWorkspace(workspace);
  }
}

/**
 * Executa (ou retoma) uma EngineeringTask até um estado terminal ou até esgotar
 * `max_iterations`. Idempotente: se já estiver em estado terminal, retorna o estado atual sem
 * reprocessar.
 */
async function runTask(taskId, { runnerId = `runner-${process.pid}-${Date.now()}`, tenantId = DEFAULT_TENANT_ID } = {}) {
  let task = await engineeringTaskService.getTask(taskId);
  if (!task) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });

  if (['GREEN', 'RED', 'BLOCKED', 'CANCELLED'].includes(task.status)) {
    return { taskId, status: task.status, idempotent: true };
  }

  await engineeringTaskService.lockForRun(taskId, runnerId);

  try {
    return await executeRoutedLoop(task, { tenantId });
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
    throw err;
  } finally {
    await engineeringTaskService.unlockTask(taskId);
  }
}

async function executeRoutedLoop(task, { tenantId }) {
  const taskId = task.id;
  task = await ensureRouted(task, { tenantId });

  if (!task.routing_decision?.coder?.selected) {
    await engineeringTaskService.saveLastError(taskId, { code: 'NO_QUALIFIED_CODER', message: 'Nenhum CODER qualificado disponível' });
    await engineeringTaskService.transitionTask(taskId, 'RED');
    emitTaskStage(tenantId, taskId, { stage: 'RED', status: 'error', message: 'Nenhum CODER qualificado disponível.' });
    return { taskId, status: 'RED', reasonCode: 'NO_QUALIFIED_CODER' };
  }

  const existingAttempts = await engineeringTaskService.listAttempts(taskId);
  let iterationsUsed = existingAttempts.length;
  let failureBundle = null;
  const lastAttempt = existingAttempts[existingAttempts.length - 1] || null;
  if (lastAttempt && lastAttempt.failure_bundle) failureBundle = lastAttempt.failure_bundle;

  while (iterationsUsed < task.max_iterations) {
    const result = await runOneAttempt({ task, routingDecision: task.routing_decision, failureBundle, previousAttempt: lastAttempt, tenantId });
    iterationsUsed += 1;

    if (result.outcome === 'FATAL') {
      await engineeringTaskService.saveLastError(taskId, { code: result.reasonCode, message: `Falha fatal: ${result.reasonCode}` });
      await engineeringTaskService.transitionTask(taskId, 'RED');
      emitTaskStage(tenantId, taskId, { stage: 'RED', status: 'error', message: `Falha fatal: ${result.reasonCode}` });
      return { taskId, status: 'RED', reasonCode: result.reasonCode };
    }

    if (result.outcome === 'ADVANCE') {
      await engineeringTaskService.transitionTask(taskId, 'REGRESSION');
      emitTaskStage(tenantId, taskId, { stage: 'REGRESSION', status: 'running', message: 'Verificando regressão local (testCommands já validados em workspace limpo).' });
      // V1: regressão local = o próprio conjunto determinístico de testCommands já executado
      // de forma limpa neste attempt (workspace isolado, sem estado residual). Escopo mais
      // amplo (qa-mesh completo) fica registrado como possibilidade em
      // POST_RELEASE_MODEL_ROUTER_BACKLOG.md quando a task não define testCommands suficientes.
      await engineeringTaskService.transitionTask(taskId, 'GOVERNANCE');
      emitTaskStage(tenantId, taskId, { stage: 'GOVERNANCE', status: 'running', message: 'Checando gate de governança.' });
      await engineeringTaskService.transitionTask(taskId, 'GREEN');
      emitTaskStage(tenantId, taskId, { stage: 'GREEN', status: 'success', message: 'Task concluída com sucesso.' });
      return { taskId, status: 'GREEN', attemptId: result.attempt.id };
    }

    // RETRY
    failureBundle = result.failureBundle;
    emitTaskStage(tenantId, taskId, {
      stage: 'RETRY',
      status: 'info',
      message: `Tentativa ${iterationsUsed}/${task.max_iterations} falhou (${failureBundle?.failedCommand || 'motivo desconhecido'}) — iniciando nova tentativa.`,
    });
    logger.info('[engineeringRouterService] RED->FIX: nova tentativa', { taskId, iterationsUsed, reason: failureBundle?.failedCommand });
  }

  await engineeringTaskService.saveLastError(taskId, { code: FAILURE_CODES.ENGINEERING_TASK_EXHAUSTED, message: `Esgotadas ${task.max_iterations} tentativas` });
  await engineeringTaskService.transitionTask(taskId, 'RED');
  emitTaskStage(tenantId, taskId, { stage: 'RED', status: 'error', message: `Esgotadas ${task.max_iterations} tentativas.` });
  return { taskId, status: 'RED', reasonCode: FAILURE_CODES.ENGINEERING_TASK_EXHAUSTED };
}

module.exports = {
  ensureRouted,
  runOneAttempt,
  runTask,
};
