'use strict';

/**
 * api/services/engineeringMission/bugLoopCoordinatorService.js
 *
 * O LOOP AUTÔNOMO. É a única peça que amarra detecção → triagem → reprodução → confirmação → task →
 * correção (Router) → testes → parecer → regressão → retomada da missão original.
 *
 * Nada aqui é um subsistema paralelo: a correção roda pelo `engineeringRouterService.runTask` (o
 * mesmo loop durável, com lease/fence/sandbox/regressão/governança), o trabalho é uma
 * `EngineeringTask` normal, a missão continua a mesma (`missionOrchestratorService`).
 *
 * O que este serviço garante, e que é o ponto da missão:
 *   - um bug NÃO interrompe a missão original: ele vira trabalho interno dela (BUG-11);
 *   - um bug secundário encontrado durante a correção entra na fila, sem abandonar o primeiro (BUG-10);
 *   - "patch aplicado" nunca é declarado FIXED; "teste verde isolado" nunca é regressão validada;
 *   - self-modification não roda autonomamente antes da aprovação humana exigida por policy.
 */

const engine = require('../../../engine/engineeringMission/bugFinding');
const bugFindingService = require('./bugFindingService');
const bugReproductionService = require('./bugReproductionService');
const bugTriageService = require('./bugTriageService');
const engineeringTaskService = require('../engineeringRouter/engineeringTaskService');
const { runTask } = require('../engineeringRouter/engineeringRouterService');
const missionOrchestratorService = require('./missionOrchestratorService');
const missionStore = require('./missionStoreService');
const logger = require('../../utils/logger');

const PLATFORM_TENANT_ID = 'system';
const DEFAULT_MAX_FIX_ATTEMPTS = 2;

function models() {
  const index = require('../../db/models');
  return {
    RegressionRun: index.getEngineeringRegressionRun(),
    Review: index.getEngineeringReview(),
  };
}

/** Lê as execuções de regressão REAIS do fix task (persistidas por `checkRegression`). */
async function readRegressionRuns(fixTaskId) {
  const { RegressionRun } = models();
  if (!RegressionRun) return [];
  const rows = await RegressionRun.findAll({ where: { task_id: fixTaskId }, order: [['created_at', 'ASC']] });
  return (rows || []).map((row) => {
    const plain = row.get ? row.get({ plain: true }) : row;
    return {
      id: plain.id,
      planTier: plain.plan_tier,
      commands: plain.commands,
      result: plain.result,
      passed: plain.result === 'PASS',
      sourceFingerprint: plain.source_fingerprint,
      evidenceRefs: plain.evidence_refs,
      completedAt: plain.completed_at,
    };
  });
}

/** Lê os pareceres REAIS do attempt (nunca presumidos pelo loop). */
async function readReviews(attemptId) {
  const { Review } = models();
  if (!Review || !attemptId) return [];
  const rows = await Review.findAll({ where: { attempt_id: attemptId }, order: [['created_at', 'ASC']] });
  return (rows || []).map((row) => {
    const plain = row.get ? row.get({ plain: true }) : row;
    return { id: plain.id, decision: plain.decision, findings: plain.findings || [], reviewerProvider: plain.reviewer_provider, reviewerModel: plain.reviewer_model };
  });
}

/** Comandos de teste REALMENTE executados no attempt (para provar que a reprodução rodou e passou). */
async function readTestRuns(attemptId) {
  if (!attemptId) return [];
  const runs = await engineeringTaskService.listTestRuns(attemptId).catch(() => []);
  return (Array.isArray(runs) ? runs : []).map((run) => ({
    command: run.command,
    status: run.status,
    outcome: run.outcome || run.status,
    exitCode: run.exit_code ?? run.exitCode ?? null,
    stdoutRef: run.stdout_ref || null,
    stderrRef: run.stderr_ref || null,
  }));
}

function sameCommand(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

/**
 * Executa a correção pelo Router e reconcilia o finding com o resultado REAL.
 * Nunca declara FIXED por "task terminou": exige reprodução verde + testes direcionados verdes +
 * parecer aprovado + execuções de regressão.
 */
async function runFixLoop(findingId, {
  actor = null, tenantId = null, maxAttempts = DEFAULT_MAX_FIX_ATTEMPTS,
  credentialScope = undefined, specFreshnessGuard = null, missionLease = null, secondaryFindings = [],
} = {}) {
  const finding = await bugFindingService.getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  if (!finding.fix_task_id) {
    return { finding, executed: false, fixed: false, stage: 'NO_FIX_TASK', reason: 'finding sem task de correção — rode a triagem antes' };
  }

  const guard = await bugTriageService.canRunFixAutonomously(findingId);
  if (!guard.allowed) {
    return {
      finding,
      executed: false,
      fixed: false,
      stage: 'AWAITING_HUMAN_APPROVAL',
      blocked: true,
      code: guard.code,
      reason: guard.reason,
      minimumHumanAction: guard.minimumHumanAction,
    };
  }

  const attempts = [];
  let lastResult = null;

  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
    // `|| {}` é defensivo de propósito: uma execução que devolve vazio NUNCA pode ser lida como
    // "GREEN" nem derrubar o coordenador — o status vira UNKNOWN e o ciclo para declarando isso.
    const result = (await runTask(finding.fix_task_id, {
      ...(credentialScope ? { credentialScope } : {}),
      ...(tenantId ? { eventAudienceTenantId: tenantId } : {}),
      ...(specFreshnessGuard ? { specFreshnessGuard } : {}),
      ...(missionLease ? { lease: missionLease } : {}),
    })) || {};
    lastResult = result;
    attempts.push({ attempt, status: result.status || 'UNKNOWN', reasonCode: result.reasonCode || null, attemptId: result.attemptId || null });

    if (result.status === 'GREEN') break;
    // BUG SECUNDÁRIO (BUG-10): qualquer falha que o Router registrou vira finding próprio, MAS o
    // Bug A continua no loop — nunca se abandona o primeiro para perseguir o segundo.
    for (const secondary of secondaryFindings) {
      await handleAnomaly({ ...secondary, missionId: secondary.missionId || finding.mission_id, taskId: finding.fix_task_id }, { autoFix: false, actor });
    }
    // BLOCKED/LEASE_LOST não melhoram com retry imediato: param aqui e ficam declarados.
    if (['LEASE_LOST', 'BLOCKED', 'CANCELLED'].includes(result.status)) break;
  }

  const task = await engineeringTaskService.getTask(finding.fix_task_id);
  const taskStatus = task?.status || lastResult?.status || null;
  const attemptId = lastResult?.attemptId
    || (await engineeringTaskService.listAttempts(finding.fix_task_id).catch(() => []))?.slice(-1)?.[0]?.id
    || null;

  if (taskStatus !== 'GREEN') {
    await bugFindingService.recordEvent(findingId, 'COMMENT', {
      kind: 'FIX_NOT_GREEN',
      taskStatus,
      attempts,
      reasonCode: lastResult?.reasonCode || null,
    }, { actor });
    logger.warn('[bugLoopCoordinator] correção não chegou a GREEN', { findingId, taskStatus, attempts: attempts.length });
    return { finding: await bugFindingService.getFinding(findingId), executed: true, fixed: false, stage: 'NOT_GREEN', taskStatus, attempts };
  }

  // ── GREEN: provar as TRÊS condições antes de declarar FIXED ─────────────────────────────────
  const testRuns = await readTestRuns(attemptId);
  const reproductionCommand = finding.reproduction?.command || null;
  const reproductionRun = reproductionCommand
    ? testRuns.find((run) => sameCommand(run.command, reproductionCommand))
    : null;
  const reproductionPassed = reproductionCommand
    ? Boolean(reproductionRun && reproductionRun.outcome === 'PASS')
    : testRuns.length > 0 && testRuns.every((run) => run.outcome === 'PASS');
  const targetedTestsPassed = testRuns.length > 0 && testRuns.every((run) => run.outcome === 'PASS');
  const reviews = await readReviews(attemptId);
  const reviewPassed = reviews.some((r) => r.decision === 'APPROVE');

  const fixEvidence = [];
  if (reproductionRun) {
    fixEvidence.push(bugFindingService.makeEvidence({
      type: 'REPRODUCTION_RESULT',
      ref: reproductionRun.stdoutRef || `task:${finding.fix_task_id}:reproduction`,
      detail: `reprodução "${reproductionCommand}" → ${reproductionRun.outcome} (exit ${reproductionRun.exitCode})`,
      source: 'bugLoopCoordinatorService',
    }));
  }
  for (const review of reviews.filter((r) => r.decision === 'APPROVE')) {
    fixEvidence.push(bugFindingService.makeEvidence({
      type: 'REVIEW_VERDICT',
      ref: `review:${review.id}`,
      detail: `parecer APPROVE por ${review.reviewerProvider || 'revisor'}:${review.reviewerModel || 'n/d'}`,
      source: 'bugLoopCoordinatorService',
    }));
  }

  await bugFindingService.markFixApplied(findingId, {
    actor, taskId: finding.fix_task_id, attemptId,
    evidence: fixEvidence,
    promotion: { taskStatus, testRuns: testRuns.length, reviewCount: reviews.length },
  });

  let fixed = false;
  let fixedError = null;
  try {
    await bugFindingService.markFixed(findingId, {
      actor,
      reproductionPassed,
      targetedTestsPassed,
      reviewPassed,
      reproduction: {
        ...(finding.reproduction || {}),
        command: reproductionCommand,
        expect: finding.reproduction?.expect || 'FAIL',
        lastOutcome: 'PASS',
        fixedAt: new Date().toISOString(),
      },
      review: {
        decision: reviews.some((r) => r.decision === 'APPROVE') ? 'APPROVE' : 'REJECT',
        reviewedBy: reviews.map((r) => r.reviewerModel).filter(Boolean),
        regressionCommands: testRuns.map((r) => r.command),
      },
      tenantId,
    });
    fixed = true;
  } catch (err) {
    fixedError = { code: err.code, message: err.message, detail: err.detail || null };
    logger.warn('[bugLoopCoordinator] FIXED recusado', { findingId, code: err.code, message: err.message });
  }

  if (!fixed) {
    return { finding: await bugFindingService.getFinding(findingId), executed: true, fixed: false, stage: 'FIXED_REFUSED', taskStatus, attempts, fixError: fixedError };
  }

  // ── REGRESSÃO: só com execuções REAIS do fix task ────────────────────────────────────────────
  const runs = await readRegressionRuns(finding.fix_task_id);
  let regressionValidated = false;
  let regressionError = null;
  try {
    await bugFindingService.markRegressionValidated(findingId, { actor, runs, tenantId });
    regressionValidated = true;
  } catch (err) {
    regressionError = { code: err.code, message: err.message };
    logger.warn('[bugLoopCoordinator] regressão não validada', { findingId, code: err.code, message: err.message });
  }

  let closed = false;
  if (regressionValidated) {
    try {
      await bugFindingService.closeFinding(findingId, { actor, reason: 'reprodução verde + testes + parecer + regressão', tenantId });
      closed = true;
    } catch (err) {
      regressionError = { code: err.code, message: err.message };
    }
  }

  return {
    finding: await bugFindingService.getFinding(findingId),
    executed: true,
    fixed,
    stage: closed ? 'CLOSED' : (regressionValidated ? 'REGRESSION_VALIDATED' : 'FIXED'),
    regressionValidated,
    closed,
    taskStatus,
    attempts,
    evidence: { reproductionPassed, targetedTestsPassed, reviewPassed, regressionRuns: runs.length },
    fixError: fixedError,
    regressionError,
  };
}

/**
 * Retoma a MISSÃO ORIGINAL (BUG-11). Não reinicia nada nem cria missão nova: reconcilia o estado da
 * missão existente com a task real e registra que o ponto de retorno foi atingido.
 */
async function continueMission(missionId, { actor = null, tenantId = null, findingId = null } = {}) {
  const mission = await missionStore.getMission(missionId);
  if (!mission) return { resumed: false, reason: 'mission_not_found', missionId };
  const detail = await missionOrchestratorService.refreshMissionState(missionId, { tenantId });
  await missionStore.mergeMissionJson(missionId, {
    bugLoop: { lastResumeAt: new Date().toISOString(), findingId, actor },
  }).catch(() => {});
  const refreshed = await missionStore.getMission(missionId);
  return {
    resumed: true,
    missionId,
    status: refreshed?.status || mission.status,
    displayStatus: detail?.displayStatus || null,
    linkedTaskId: refreshed?.linked_task_id || null,
  };
}

/**
 * ENTRADA ÚNICA DO LOOP. Recebe uma anomalia/falha de qualquer fonte, registra o finding, tenta
 * reproduzir, confirma (só com base objetiva), tria, corrige pelo Router, valida regressão e
 * retorna à missão original.
 */
async function handleAnomaly(input = {}, {
  actor = null, tenantId = null, autoReproduce = true, autoFix = true, autoTriage = true,
  runner = bugReproductionService.defaultRunner, invariantResults = null, maxAttempts = DEFAULT_MAX_FIX_ATTEMPTS,
  allowedPaths = null, forbiddenPaths = [], explicitPolicyAuthorization = false, policy = null,
  secondaryFindings = [], continueOriginalMission = true,
} = {}) {
  const registered = await bugFindingService.registerFinding(input, { actor, tenantId });
  let finding = registered.finding;

  // Reincidência / ocorrência repetida: já existe ciclo em andamento — não se cria trabalho novo.
  if (registered.deduplicated) {
    return { finding, deduplicated: true, outcome: 'DEDUPLICATED', recurrence: false };
  }

  const report = {
    finding,
    deduplicated: false,
    recurrence: registered.recurrence === true,
    reproduced: null,
    confirmed: false,
    triaged: null,
    fix: null,
    missionContinuation: null,
  };

  if (autoReproduce) {
    const plan = bugReproductionService.buildPlan(finding);
    if (plan.kind !== 'UNAVAILABLE') {
      const reproduction = await bugReproductionService.reproduce(finding.id, { actor, tenantId, runner, invariantResults });
      report.reproduced = reproduction.outcome;
      finding = reproduction.finding;
    } else {
      report.reproduced = 'PLAN_UNAVAILABLE';
    }
  }

  report.confirmed = finding.status === 'CONFIRMED' || finding.status === 'FIXING';
  if (!report.confirmed) {
    report.outcome = finding.status;
    return report;
  }

  if (autoTriage) {
    report.triaged = await bugTriageService.triage(finding.id, {
      actor, tenantId, allowedPaths, forbiddenPaths, explicitPolicyAuthorization, policy,
    });
    finding = report.triaged.finding;
    if (report.triaged.requiresNonApplicationAction) {
      report.outcome = 'CONFIRMED_NON_APPLICATION_ACTION';
      return report;
    }
  }

  if (autoFix) {
    report.fix = await runFixLoop(finding.id, {
      actor, tenantId, maxAttempts, secondaryFindings,
      ...(policy && policy.credentialScope ? { credentialScope: policy.credentialScope } : {}),
    });
    finding = report.fix.finding || finding;
  }

  if (continueOriginalMission && input.missionId) {
    report.missionContinuation = await continueMission(input.missionId, { actor, tenantId, findingId: finding.id });
  }

  report.finding = finding;
  report.outcome = finding.status;
  return report;
}

/**
 * Consolida uma coleção de eventos de telemetria em findings SUSPECTED (nunca confirmados). Usado
 * por quem já coleta telemetria do Router/missão — o motor decide o que é padrão relevante.
 */
async function ingestTelemetry({ metrics = {}, context = {}, thresholds = null, missionId = null, taskId = null }, { actor = 'SYSTEM:TELEMETRY', tenantId = null } = {}) {
  const detections = engine.detectAnomalies({ metrics, thresholds, context });
  const registered = [];
  for (const detection of detections) {
    const result = await bugFindingService.registerFinding({
      missionId: missionId || detection.missionId || null,
      taskId: taskId || null,
      source: detection.source,
      title: detection.title,
      description: `${detection.expected} / observado: ${detection.observed}`,
      expectedBehavior: detection.expected,
      observedBehavior: detection.observed,
      category: detection.categoryHint,
      subsystem: detection.subsystem,
      route: detection.route,
      test: detection.test,
      signals: detection.signals,
      affectedSubsystems: detection.subsystem ? [detection.subsystem] : [],
      fingerprint: engine.computeFingerprint({ ...detection, subsystem: detection.subsystem, test: detection.test, route: detection.route }),
      // Anomalia NUNCA entra com base de confirmação: vira SUSPECTED e espera reprodução.
      evidenceRefs: [{
        type: 'LOG_CORRELATION',
        ref: `telemetry:${detection.code}`,
        detail: detection.observed,
        source: 'bugLoopCoordinatorService.ingestTelemetry',
      }],
    }, { actor, tenantId });
    registered.push({ code: detection.code, findingId: result.finding.id, deduplicated: result.deduplicated, diagnosticOnly: detection.diagnosticOnly === true });
  }
  return { detections: detections.length, registered };
}

/** Diagnóstico de NO_PROGRESS (BUG-13): captura fase/operação/último progresso e SÓ então decide. */
async function diagnoseNoProgress({ missionId = null, taskId = null, phase = null, operation = null, metadata = {} } = {}, { actor = 'SYSTEM:NO_PROGRESS', tenantId = null } = {}) {
  const metrics = {
    noProgress: true,
    phase: phase || metadata.phase || null,
    operation: operation || metadata.operation || null,
    lastProgressSignal: metadata.lastProgressSignal || null,
    providerStatus: metadata.providerStatus || null,
    childStatus: metadata.childStatus || null,
    subsystem: metadata.subsystem || null,
  };
  const result = await ingestTelemetry({ metrics, context: { subsystem: metrics.subsystem }, missionId, taskId }, { actor, tenantId });
  return { ...result, diagnostic: metrics };
}

/**
 * DETECÇÃO DENTRO DE UMA MISSÃO EM EXECUÇÃO (missão §"durante uma Engineering Mission"). Chamado
 * pelo orquestrador quando a execução da task NÃO termina em GREEN: a falha vira finding da PRÓPRIA
 * missão, sem exigir ZIP, prompt ou missão nova.
 *
 * Aqui só se REGISTRA (leitura/escrita de banco, rápida e determinística). Reprodução, triagem e
 * correção acontecem no laço (`runBugLoopSweep`) — assim a execução da missão não passa a esperar
 * por sandbox/reprodução, e a ordem "detectar → reproduzir → confirmar" continua honesta.
 */
async function hookMissionFailure({ missionId, taskId, result = {}, extra = {} }, { actor = 'SYSTEM:MISSION', tenantId = null } = {}) {
  const status = String(result.status || 'UNKNOWN');
  const title = `Missão ${missionId}: task ${taskId} terminou em ${status}${result.reasonCode ? ` (${result.reasonCode})` : ''}`;

  // PROCEDÊNCIA (§ não confundir trabalho real com verificação). Uma missão criada por um script de
  // VERIFICAÇÃO/gate (`verify-real-task-recovery`, `verify-mission-crash-recovery`) ou por suíte Jest
  // produz falhas REAIS, mas não é trabalho de engenharia: o finding continua sendo REGISTRADO
  // (visível, auditável, com occorrências) e não é silenciado — apenas não vira item de correção no
  // laço, porque "consertar" uma missão de verificação seria trabalho sobre um artefato de prova.
  // Nenhuma detecção é enfraquecida: a classificação continua igual; muda só a ROTEABILIDADE.
  let provenance = extra.provenance || 'WORK';
  try {
    const mission = await missionStore.getMission(missionId);
    const createdBy = String(mission?.created_by || '');
    if (/^(verify[-_]|jest|test\b|e2e)/i.test(createdBy)) provenance = 'VERIFICATION';
  } catch (err) {
    logger.warn('[bugLoopCoordinator] falha ao resolver proveniência da missão', { missionId, error: err.message });
  }

  return bugFindingService.registerFinding({
    missionId,
    taskId,
    provenance,
    source: extra.source || 'EXCEPTION',
    title,
    description: extra.description || `resultado real da execução: ${status}`,
    expectedBehavior: 'a task da missão conclui em GREEN pelos seus próprios gates',
    observedBehavior: `status=${status}${result.reasonCode ? ` reasonCode=${result.reasonCode}` : ''}`,
    category: extra.category || undefined,
    subsystem: extra.subsystem || 'ENGINEERING_MISSION',
    symbol: `mission_task:${status}`,
    signals: [],
    affectedSubsystems: extra.affectedSubsystems || [],
    affectedFiles: extra.affectedFiles || [],
    reproduction: extra.reproduction || {},
    evidenceRefs: [{
      type: 'ARTIFACT',
      ref: `engineering_task:${taskId}`,
      detail: `task ${taskId} terminal em ${status}`,
      source: 'bugLoopCoordinatorService.hookMissionFailure',
    }],
  }, { actor, tenantId });
}

/**
 * VARREDURA DO LOOP: pega os findings que precisam de ação e os conduz.
 *   - SUSPECTED/REPRODUCING com plano de reprodução → reproduz (confirma ou não);
 *   - CONFIRMED/FIXING sem task de correção → tria (cria a EngineeringTask);
 *   - com task e sem correção executada → executa o fix loop pelo Router.
 * Idempotente: nunca duplica task e nunca reabre ciclo já fechado.
 */
async function runBugLoopSweep({
  limit = 10, actor = 'SYSTEM:BUG_LOOP', tenantId = null, autoFix = true,
  runner = bugReproductionService.defaultRunner, invariantResults = null, maxAttempts = DEFAULT_MAX_FIX_ATTEMPTS,
  allowedPaths = null, policy = null,
} = {}) {
  const summary = { scanned: 0, confirmed: 0, triaged: 0, fixed: 0, awaitedApproval: 0, items: [] };

  const pending = await bugFindingService.listFindings({ status: ['SUSPECTED', 'REPRODUCING'], limit });
  for (const finding of pending) {
    summary.scanned += 1;
    const plan = bugReproductionService.buildPlan(finding);
    if (plan.kind === 'UNAVAILABLE') {
      summary.items.push({ findingId: finding.id, action: 'NO_REPRODUCTION_PLAN' });
      continue;
    }
    const reproduction = await bugReproductionService.reproduce(finding.id, { actor, tenantId, runner, invariantResults });
    summary.items.push({ findingId: finding.id, action: 'REPRODUCED', outcome: reproduction.outcome });
    if (reproduction.outcome === 'REPRODUCED') summary.confirmed += 1;
  }

  const confirmed = await bugFindingService.listFindings({ status: ['CONFIRMED', 'FIXING'], limit });
  for (const finding of confirmed) {
    // Finding de missão de VERIFICAÇÃO/teste é registrado e auditável, mas não vira item de correção:
    // corrigir uma missão de prova seria trabalho sobre um artefato de verificação, não sobre o produto.
    if (finding.triage && finding.triage.provenance === 'VERIFICATION') {
      summary.items.push({ findingId: finding.id, action: 'SKIPPED_VERIFICATION_PROVENANCE' });
      continue;
    }
    if (!finding.fix_task_id) {
      const triage = await bugTriageService.triage(finding.id, { actor, tenantId, allowedPaths, policy });
      summary.triaged += 1;
      summary.items.push({ findingId: finding.id, action: 'TRIAGED', taskId: triage.fixTask?.id || null });
      if (triage.requiresHumanApproval || triage.requiresNonApplicationAction) {
        if (triage.requiresHumanApproval) summary.awaitedApproval += 1;
        continue;
      }
      if (!autoFix) continue;
      const fix = await runFixLoop(finding.id, { actor, tenantId, maxAttempts });
      if (fix.blocked) {
        summary.awaitedApproval += 1;
        summary.items.push({ findingId: finding.id, action: 'AWAITING_HUMAN_APPROVAL', code: fix.code });
        continue;
      }
      if (fix.closed) summary.fixed += 1;
      summary.items.push({ findingId: finding.id, action: 'FIX_LOOP', status: fix.finding?.status || null, closed: Boolean(fix.closed) });
      continue;
    }
    if (finding.status === 'FIXING' && autoFix) {
      const fix = await runFixLoop(finding.id, { actor, tenantId, maxAttempts });
      if (fix.executed && fix.closed) summary.fixed += 1;
      summary.items.push({ findingId: finding.id, action: 'FIX_LOOP_RESUME', status: fix.finding?.status || null });
    }
  }

  return summary;
}

module.exports = {
  PLATFORM_TENANT_ID,
  DEFAULT_MAX_FIX_ATTEMPTS,
  readRegressionRuns,
  readReviews,
  readTestRuns,
  runFixLoop,
  continueMission,
  handleAnomaly,
  ingestTelemetry,
  diagnoseNoProgress,
  hookMissionFailure,
  runBugLoopSweep,
};
