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
const { parseCommand } = require('../../../engine/engineeringRouter/commandPolicy');
const { runTask } = require('../engineeringRouter/engineeringRouterService');
const missionStore = require('./missionStoreService');
const missionSourceService = require('./missionSourceService');
const logger = require('../../utils/logger');

/**
 * Lazy require do orquestrador: existe DEPENDÊNCIA CIRCULAR (orquestrador → coordinator para o hook
 * de falha; coordinator → orquestrador para retomar a missão). Com o require no topo, um dos lados
 * recebe um objeto PARCIAL — medido em 2026-09-30: `startExecution is not a function`, o que
 * silenciava a retomada da missão (`replacementTaskId` nulo). Mesmo padrão já usado por
 * `missionRecoveryCoordinator` e `missionReviewService`.
 */
function orchestratorService() {
  return require('./missionOrchestratorService');
}

const PLATFORM_TENANT_ID = 'system';
const DEFAULT_MAX_FIX_ATTEMPTS = 2;
/**
 * GUARDA DE RECURSÃO (§policy de proteção contra explosão recursiva). Um finding que reincide mais
 * que este limite indica correção que NÃO resolve — insistir vira laço infinito. Não é timeout
 * global: é limite por finding, com evidência persistida.
 */
const MAX_FINDING_RECURRENCE = (() => {
  const raw = Number(process.env.ENGINEERING_BUG_LOOP_MAX_RECURRENCE);
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
})();

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
    // REGRESSÕES DECLARADAS SÓ PODEM SER COMANDOS.
    //
    // DEFEITO REAL (primeira ocorrência medida em 2026-09-30, silenciosa por dois dias): esta lista
    // alimenta `regressionCommands`, que o `markFixed` persiste em `regression_test_refs` do finding.
    // Essa memória é RECUPERADA depois (`getFindingMemory`) e INJETADA em `test_commands` da próxima
    // fix task. Um valor que não é comando (medido: um UUID) entrava aqui, era persistido, e voltava
    // como "regressão a rodar" — e `parseCommand` rejeitava, produzindo `TEST_BLOCKED` ⇒ 3 tentativas
    // esgotadas ⇒ task RED. Sem GREEN não há promoção, integração nem retomada da missão: o laço
    // simplesmente não fechava, e o sintoma ("tentativas esgotadas") ficava longe da causa (um id no
    // lugar de um comando).
    //
    // A validação aqui é na ENTRADA, e o descarte é RUIDOSO de propósito: filtrar em silêncio
    // esconderia o produtor defeituoso. A memória é persistente, então um dado ruim de hoje
    // contaminaria o fix de amanhã.
    const toCommands = (values) => {
      const kept = [];
      const rejected = [];
      for (const value of values) {
        const candidate = String(value || '').trim();
        if (candidate === '') continue;
        const policy = parseCommand(candidate);
        if (policy.allowed) kept.push(candidate);
        else rejected.push({ value: candidate, code: policy.code || null, reason: policy.reason || null });
      }
      return { kept, rejected };
    };

    const regressionScan = toCommands(testRuns.map((r) => r.command));
    if (regressionScan.rejected.length > 0) {
      logger.warn('[bugLoopCoordinator] valores descartados de regressionCommands — não são comandos executáveis', {
        findingId,
        rejected: regressionScan.rejected,
        detail: 'a memória de regressão é persistida e reutilizada no contrato da próxima correção; um id no lugar de um comando faz a próxima fix task falhar com TEST_BLOCKED',
      });
    }

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
        regressionCommands: regressionScan.kept,
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

  // ── SELF-MODIFICATION: o fix afrouxou o PRÓPRIO critério que o reprovava? ──────────────────
  // Se afetou as regras de julgamento, a comparação baseline×atual precisa acontecer ANTES de
  // qualquer fechamento: um sistema não pode consertar-se afrouxando o teste que o reprova. A
  // violação bloqueia o fechamento e o finding fica aguardando aval HUMANO — sem exceção.
  let baselineVerdict = null;
  if (finding.self_modification) {
    baselineVerdict = await bugTriageService.verifySelfModificationBaseline(findingId, { actor });
    if (!baselineVerdict.ok) {
      await bugFindingService.recordEvent(findingId, 'COMMENT', {
        kind: 'AUTONOMOUS_FIX_BLOCKED',
        reason: 'governance_baseline',
        code: baselineVerdict.code,
        changed: Boolean(baselineVerdict.diff && baselineVerdict.diff.changed),
        minimumHumanAction: 'aprovar explicitamente a alteração das regras de julgamento (POST /engineering/findings/:id/approve-self-modification com actorType=HUMAN)',
      }, { actor });
      logger.warn('[bugLoopCoordinator] fix de self-modification afrouxa o próprio critério — fechamento bloqueado', {
        findingId, code: baselineVerdict.code,
      });
      return {
        finding: await bugFindingService.getFinding(findingId),
        executed: true,
        fixed: true,
        closed: false,
        blocked: true,
        stage: 'AWAITING_HUMAN_APPROVAL',
        code: baselineVerdict.code,
        baseline: baselineVerdict,
        taskStatus,
        attempts,
      };
    }
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
    baselineVerified: finding.self_modification ? Boolean(baselineVerdict && baselineVerdict.ok) : null,
    fixError: fixedError,
    regressionError,
  };
}

/**
 * RETOMADA REAL DA MISSÃO ORIGINAL (BUG-11 / §"continuar de onde deve").
 *
 * Não basta mudar status: o caminho normal precisa VOLTAR a executar. O mecanismo canônico de
 * continuação já existe no orquestrador (`startExecution` → cria a task substituta a partir da
 * MissionSpec aprovada e supersede a task que falhou, sob lease). Aqui apenas se decide e se
 * registra a linhagem exigida pela missão:
 *   originalTaskId, findingId, fixTaskId, replacementTaskId, missionId, MissionSpec version/hash.
 *
 * A decisão é explícita e persistida (`decision`), nunca implícita:
 *   - REPLACE_TASK_RESUME_PHASE — task original falhou e a missão retoma por task substituta;
 *   - RESUME_CHECKPOINT        — task original está GREEN (o fix resolveu sem nova execução);
 *   - NOT_EXECUTABLE           — missão não está executável (policy/approval) e o motivo é gravado.
 */
async function resumeOriginalMission({ missionId, findingId = null, fixTaskId = null, actor = null, tenantId = null, execute = true } = {}) {
  if (!missionId) return { resumed: false, reason: 'mission_id_ausente' };
  const mission = await missionStore.getMission(missionId);
  if (!mission) return { resumed: false, reason: 'mission_not_found', missionId };

  const originalTaskId = mission.linked_task_id || null;
  const originalTask = originalTaskId ? await engineeringTaskService.getTask(originalTaskId).catch(() => null) : null;
  const decision = originalTask && originalTask.status === 'GREEN'
    ? 'RESUME_CHECKPOINT'
    : 'REPLACE_TASK_RESUME_PHASE';

  const lineage = {
    missionId,
    originalTaskId,
    findingId,
    fixTaskId,
    replacementTaskId: null,
    missionSpecVersion: mission.spec_version ?? mission.specVersion ?? null,
    missionSpecHash: mission.spec_hash ?? mission.specHash ?? null,
    decision,
    decidedAt: new Date().toISOString(),
    actor,
  };

  if (!execute) {
    return { resumed: false, reason: 'execute=false', decision, lineage };
  }

  try {
    const orch = orchestratorService();
    // REABERTURA CONTROLADA. Uma falha técnica deixa a missão em FAILED (estado TERMINAL) e o CAS
    // de lease RECUSA estado terminal — sem reabrir, a missão nunca voltaria a executar (medido:
    // `MISSION_TERMINAL_OR_UNKNOWN`). A reabertura é decisão REGISTRADA e vale apenas para falha
    // técnica (FAILED). BLOCKED/DEGRADED/REJECTED/CANCELLED continuam exigindo decisão HUMANA:
    // o laço NUNCA auto-aprova o que a policy reserva a gente.
    const AUTO_REOPENABLE = ['FAILED'];
    const HUMAN_ONLY = ['BLOCKED', 'DEGRADED', 'REJECTED', 'CANCELLED'];
    const missionStatus = String(mission.status || '');
    let reopenedFrom = null;
    if (AUTO_REOPENABLE.includes(missionStatus)) {
      await missionStore.updateMission(missionId, { status: 'EXECUTING' });
      reopenedFrom = missionStatus;
      lineage.reopenedFrom = reopenedFrom;
      lineage.decision = 'MISSION_REOPENED_AFTER_FIX';
    } else if (HUMAN_ONLY.includes(missionStatus)) {
      lineage.decision = 'NOT_EXECUTABLE';
      lineage.reason = `missão em ${missionStatus} exige decisão humana`;
      await missionStore.mergeMissionJson(missionId, {
        resume: { bugLoop: { lastResumeAt: new Date().toISOString(), findingId, lineage } },
      }).catch(() => {});
      logger.warn('[bugLoopCoordinator] retomada não é automática para este estado', { missionId, status: missionStatus, findingId });
      return { resumed: false, decision: 'NOT_EXECUTABLE', missionId, reason: lineage.reason, lineage };
    }
    // POSSE DA MISSÃO na retomada. Sem posse administrativa (que ESPERA o dono vivo e tolera
    // estado terminal sem lease), a execução falhava com MISSION_LOCKED_BY_OTHER_WORKER — medido
    // em 2026-09-30: a missão ficava vinculada mas nunca voltava a executar. O lease é PROPAGADO
    // ao orquestrador (mesmo token/fence), nunca disputado com outra identidade.
    const outcome = await orch.withMissionLease(missionId, null, async ({ lease }) => {
      const TERMINAL_TASK_STATUSES = ['RED', 'GREEN', 'FAILED', 'CANCELLED', 'READY_FOR_PROMOTION'];
      let replacementTaskId = null;
      if (originalTask && TERMINAL_TASK_STATUSES.includes(String(originalTask.status))) {
        // A task original está em estado TERMINAL. O Router é idempotente por design: `runTask`
        // numa task terminal devolve o estado atual SEM reexecutar, e retomar task terminal é
        // proibido (`TASK_ALREADY_TERMINAL_DURING_RESUME`). A continuação canônica da missão é
        // uma TASK SUBSTITUTA sob o MESMO contrato de spec, criada pelos serviços existentes
        // (`buildTaskContract` + `createTask` + binding + `linkTask`) — sem duplicar o orquestrador.
        const approvalService = require('./missionApprovalService');
        const taskSpecBinding = require('./taskSpecBindingService');
        const { spec, approval } = await approvalService.assertMissionExecutable(missionId);

        // MISSION SOURCE AUTHORITY — A RETOMADA PRECISA USAR A FONTE JÁ CORRIGIDA.
        //
        // DEFEITO MEDIDO AQUI (2026-10-02): a task substituta era criada SEM herança de fonte
        // (`buildTaskContract(spec, { createdBy: actor })`), então ela nascia do HEAD da `main` —
        // não da fonte da missão. O fix que o Bug Loop acabara de produzir e integrar simplesmente
        // não existia para ela, e a reprodução original voltava a falhar. A recorrência observada
        // era ARTEFATO disso: o bug não voltou, o fix nunca esteve na source usada.
        //
        // Agora a retomada resolve o commit CORRENTE da fonte da missão — que já contém o fix
        // integrado — e a task substituta nasce dele. É literalmente o que prova
        // MISSION_RESUME_USES_FIXED_SOURCE: o `source_commit` da task nova == `missionCurrentCommit`
        // pós-integração, verificável por hash.
        await missionSourceService.ensureMissionSource(missionId, { actor });
        const missionSource = await missionSourceService.resolveTaskSource(missionId);

        const contract = orch.buildTaskContract(spec, {
          createdBy: actor,
          sourceCommit: missionSource.currentCommit,
          sourceRef: missionSource.integrationBranch,
          sourceMissionFence: missionSource.fence,
        });
        const created = await engineeringTaskService.createTask(contract, {
          createdBy: actor,
          idempotencyKey: `mission:${missionId}:postbug:${findingId || 'na'}`,
        });
        replacementTaskId = created.id;
        // UMA TASK CRIADA ANTES DA INTEGRAÇÃO PRECISA SER REANCORADA. A idempotência da chave acima
        // pode devolver uma task substituta de uma retomada ANTERIOR (criada sob um commit antigo):
        // reapontar para o commit corrente é o que garante que ela enxergue TODO o histórico
        // integrado da missão (fix A, fix B, ...), não só o que existia quando ela nasceu.
        await missionSourceService.reanchorTaskToCurrentSource(created.id, { actor }).catch((err) => {
          logger.warn('[bugLoopCoordinator] falha ao reancorar task substituta na fonte corrente', {
            missionId, taskId: created.id, error: err.message,
          });
        });
        lineage.sourceCommit = missionSource.currentCommit;
        lineage.sourceBranch = missionSource.integrationBranch;
        await taskSpecBinding.bindTaskToSpec({ taskId: created.id, missionId, spec, approval })
          .catch((err) => logger.warn('[bugLoopCoordinator] falha ao vincular spec na task substituta', { missionId, taskId: created.id, error: err.message }));
        await missionStore.linkTask({ missionId, taskId: created.id });
        lineage.decision = 'REPLACE_TASK_RESUME_PHASE';
        lineage.supersededTaskId = originalTaskId;
      } else {
        // Sem task (ou task ainda executável): o próprio orquestrador inicia/retoma, com a
        // idempotência dele (missionId + versão da spec) e o lease já adquirido.
        const execution = await orch.startExecution(missionId, { actor, tenantId, ...(lease ? { lease } : {}) });
        replacementTaskId = execution?.task?.id || null;
      }
      lineage.replacementTaskId = replacementTaskId;
      // A retomada precisa ser OBSERVÁVEL: vincular/criar a task não basta — a missão volta a
      // EXECUTAR pelo caminho canônico. Sem isto, ficaria "EXECUTING" sem atividade subsequente.
      const resumedRun = await orch.runMissionTask(missionId, { tenantId, ...(lease ? { missionLease: lease } : {}) })
        .then((run) => ({ status: run?.result?.status || null }))
        .catch((err) => ({ error: { code: err.code || null, message: err.message } }));
      return { replacementTaskId, resumedRun };
    }, { administrative: true, heartbeat: true });

    lineage.replacementTaskId = outcome?.replacementTaskId || null;
    lineage.resumedRun = outcome?.resumedRun || null;
    if (!reopenedFrom && lineage.decision !== 'REPLACE_TASK_RESUME_PHASE' && lineage.replacementTaskId === originalTaskId) {
      lineage.decision = 'RETRY_ORIGINAL_TASK';
    }
    await missionStore.mergeMissionJson(missionId, {
      resume: { bugLoop: { lastResumeAt: lineage.decidedAt, findingId, lineage } },
    }).catch((err) => logger.warn('[bugLoopCoordinator] falha ao persistir linhagem de retomada', { missionId, error: err.message }));
    logger.info('[bugLoopCoordinator] missão original retomada', {
      missionId,
      originalTaskId,
      replacementTaskId: lineage.replacementTaskId,
      decision: lineage.decision,
      findingId,
      resumedStatus: lineage.resumedRun?.status || null,
    });
    return {
      resumed: true,
      decision: lineage.decision,
      missionId,
      originalTaskId,
      replacementTaskId: lineage.replacementTaskId,
      resumedRun: lineage.resumedRun,
      status: lineage.resumedRun?.status || null,
      lineage,
    };
  } catch (err) {
    // Guard de policy/approval (missão não executável) NÃO é falha do laço: é motivo declarado.
    const blocked = /APPROVAL|POLICY|NOT_EXECUTABLE|SPEC/i.test(String(err.code || err.message || ''));
    lineage.decision = blocked ? 'NOT_EXECUTABLE' : decision;
    lineage.error = { code: err.code || null, message: err.message };
    await missionStore.mergeMissionJson(missionId, {
      resume: { bugLoop: { lastResumeAt: lineage.decidedAt, findingId, lineage } },
    }).catch(() => {});
    logger.warn('[bugLoopCoordinator] retomada da missão não executou', { missionId, code: err.code || null, message: err.message });
    return { resumed: false, decision: lineage.decision, missionId, originalTaskId, reason: err.message, code: err.code || null, lineage };
  }
}

/**
 * Retoma a MISSÃO ORIGINAL (BUG-11). Não reinicia nada nem cria missão nova: reconcilia o estado da
 * missão existente com a task real e registra que o ponto de retorno foi atingido.
 */
async function continueMission(missionId, { actor = null, tenantId = null, findingId = null } = {}) {
  const mission = await missionStore.getMission(missionId);
  if (!mission) return { resumed: false, reason: 'mission_not_found', missionId };
  const detail = await orchestratorService().refreshMissionState(missionId, { tenantId });
  await missionStore.mergeMissionJson(missionId, {
    resume: { bugLoop: { lastResumeAt: new Date().toISOString(), findingId, actor } },
  }).catch((err) => logger.warn('[bugLoopCoordinator] falha ao persistir retomada', { missionId, error: err.message }));
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

  // DERIVAÇÃO AUTOMÁTICA DA REPRODUÇÃO (§ caminho normal). A falha já carrega contexto real
  // (TestRun que falhou, RegressionRun, `test_commands` da task, reasonCode determinístico):
  // sem isto o finding nasceria sem plano, o laço pararia em NO_REPRODUCTION_PLAN e o ciclo
  // autônomo nunca sairia de SUSPECTED. Nada é inventado — só se deriva de dado real.
  const providedReproduction = (extra.reproduction && Object.keys(extra.reproduction).length > 0) ? extra.reproduction : null;
  // CONTEXTO REAL DA TASK que falhou: é dele que saem o comando de reprodução e os paths afetados.
  // Sem os paths, a triagem nasce sem `allowedPaths` e a correção nunca consegue aplicar patch
  // (medido 2026-09-30 no E2E do caminho natural: finding CONFIRMED → FIXING e preso, porque
  // `affected_files` ia vazio e a spec da missão não é a fonte do contrato da task).
  const failingTask = await engineeringTaskService.getTask(taskId).catch(() => null);
  const derivedAffectedFiles = (Array.isArray(extra.affectedFiles) && extra.affectedFiles.length > 0)
    ? extra.affectedFiles
    : (Array.isArray(failingTask?.allowed_paths) ? failingTask.allowed_paths : []);
  let derivation = null;
  if (!providedReproduction) {
    try {
      const attemptId = result.attemptId
        || (await engineeringTaskService.listAttempts(taskId).catch(() => []))?.slice(-1)?.[0]?.id
        || null;
      const testRuns = attemptId ? await readTestRuns(attemptId) : [];
      derivation = engine.deriveReproductionPlan({
        task: failingTask,
        result,
        testRuns,
        source: extra.source || 'EXCEPTION',
        reasonCode: result.reasonCode || null,
      });
    } catch (err) {
      logger.warn('[bugLoopCoordinator] falha ao derivar plano de reprodução', { missionId, taskId, error: err.message });
    }
  }

  const reproduction = providedReproduction || (derivation && derivation.derived
    ? {
      ...(derivation.command ? { command: derivation.command, expect: derivation.expect } : {}),
      ...(derivation.invariants ? { invariants: derivation.invariants } : {}),
      derivation: { available: true, strategy: derivation.strategy, reason: derivation.reason },
    }
    : { derivation: { available: false, strategy: derivation?.strategy || 'NONE', reason: derivation?.reason || 'sem contexto de execução disponível no hook' } });

  const derivationEvidence = (derivation?.evidence || []).map((item) => ({ ...item, source: 'bugLoopCoordinatorService.hookMissionFailure' }));

  // PROCEDÊNCIA (§ não confundir trabalho real com verificação). Uma missão criada por um script de
  // VERIFICAÇÃO/gate (`verify-real-task-recovery`, `verify-mission-crash-recovery`) produz falhas
  // REAIS, mas não é trabalho de engenharia: o finding continua sendo REGISTRADO (visível,
  // auditável, com occorrências) e não é silenciado — apenas não vira item de correção no laço,
  // porque "consertar" uma missão de verificação seria trabalho sobre um artefato de prova.
  //
  // DEFEITO CORRIGIDO (medido 2026-09-30 pelo E2E do caminho natural): a classificação também
  // capturava qualquer `created_by` que começasse com `jest`/`test`/`e2e`. Isso silenciava
  // findings LEGÍTIMOS de missões reais criadas por suíte de teste (o finding confirmava e ficava
  // preso em CONFIRMED com `SKIPPED_VERIFICATION_PROVENANCE`). A marcação agora é PRECISA: apenas
  // criadores de verificação (`verify-*`) são artefato de prova; suíte que exercita o caminho real
  // é trabalho normal e DEVE ser corrigida.
  let provenance = extra.provenance || 'WORK';
  try {
    const mission = await missionStore.getMission(missionId);
    const createdBy = String(mission?.created_by || '');
    if (/^verify[-_]/i.test(createdBy)) provenance = 'VERIFICATION';
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
    affectedFiles: derivedAffectedFiles,
    reproduction,
    evidenceRefs: [{
      type: 'ARTIFACT',
      ref: `engineering_task:${taskId}`,
      detail: `task ${taskId} terminal em ${status}`,
      source: 'bugLoopCoordinatorService.hookMissionFailure',
    }, ...derivationEvidence],
  }, { actor, tenantId });
}

/**
 * VARREDURA DO LOOP: pega os findings que precisam de ação e os conduz.
 *   - SUSPECTED/REPRODUCING com plano de reprodução → reproduz (confirma ou não);
 *   - CONFIRMED/FIXING sem task de correção → tria (cria a EngineeringTask);
 *   - com task e sem correção executada → executa o fix loop pelo Router.
 * Idempotente: nunca duplica task e nunca reabre ciclo já fechado.
 */
/**
 * POSSE DURÁVEL de um finding durante o processamento (§“dois workers não corrigem o mesmo
 * finding”). Lease adquirido por CAS no banco + heartbeat enquanto o trabalho roda + fence
 * monotônico; se o processo morrer, o lease EXPIRA e o próximo worker assume — sem lease vitalício
 * e sem posse por PID/tempo local.
 *
 * `workerInstanceId` ausente (chamadas administrativas/testes) mantém o comportamento sem posse,
 * explicitamente, em vez de fingir exclusividade.
 */
async function withFindingLease(findingId, workerInstanceId, fn, { ttlMs = null } = {}) {
  if (!workerInstanceId) return fn({ lease: null });
  let lease;
  try {
    lease = await bugFindingService.acquireFindingLease(findingId, { workerInstanceId, ...(ttlMs ? { ttlMs } : {}) });
  } catch (err) {
    if (err.code === 'FINDING_LEASE_HELD_BY_OTHER_WORKER') return { skipped: true, code: err.code, lease: err.lease };
    throw err;
  }
  const ttl = ttlMs || bugFindingService.DEFAULT_LEASE_TTL_MS;
  const heartbeat = setInterval(() => {
    bugFindingService.heartbeatFindingLease(findingId, { token: lease.token, ttlMs: ttl }).catch((err) => {
      logger.warn('[bugLoopCoordinator] heartbeat do lease do finding falhou', { findingId, code: err.code || null });
    });
  }, Math.max(5000, Math.floor(ttl / 3)));
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
  try {
    return await fn({ lease });
  } finally {
    clearInterval(heartbeat);
    await bugFindingService.releaseFindingLease(findingId, { token: lease.token }).catch(() => {});
  }
}

async function runBugLoopSweep({
  limit = 10, actor = 'SYSTEM:BUG_LOOP', tenantId = null, autoFix = true,
  runner = bugReproductionService.defaultRunner, invariantResults = null, maxAttempts = DEFAULT_MAX_FIX_ATTEMPTS,
  allowedPaths = null, policy = null, resumeMission = true, workerInstanceId = null,
} = {}) {
  const summary = { scanned: 0, confirmed: 0, triaged: 0, fixed: 0, awaitedApproval: 0, resumed: 0, blockedRecursive: 0, leaseSkipped: 0, items: [] };

  const pending = await bugFindingService.listFindings({ status: ['SUSPECTED', 'REPRODUCING'], limit });
  for (const finding of pending) {
    summary.scanned += 1;
    const owned = await withFindingLease(finding.id, workerInstanceId, async () => {
      const plan = bugReproductionService.buildPlan(finding);
      if (plan.kind === 'UNAVAILABLE') {
        // Motivo EXPLÍCITO persistido na derivação: nunca um silêncio que finge ausência de plano.
        return { action: 'NO_REPRODUCTION_PLAN', detail: finding.reproduction?.derivation?.reason || plan.rationale || null };
      }
      const reproduction = await bugReproductionService.reproduce(finding.id, { actor, tenantId, runner, invariantResults });
      if (reproduction.outcome === 'REPRODUCED') summary.confirmed += 1;
      return { action: 'REPRODUCED', outcome: reproduction.outcome };
    });
    if (owned?.skipped) {
      summary.leaseSkipped += 1;
      summary.items.push({ findingId: finding.id, action: 'SKIPPED_LEASE_HELD', leaseWorker: owned.lease?.worker || null });
      continue;
    }
    summary.items.push({ findingId: finding.id, ...owned });
  }

  const confirmed = await bugFindingService.listFindings({ status: ['CONFIRMED', 'FIXING'], limit });
  for (const finding of confirmed) {
    // Finding de missão de VERIFICAÇÃO/teste é registrado e auditável, mas não vira item de correção:
    // corrigir uma missão de prova seria trabalho sobre um artefato de verificação, não sobre o produto.
    if (finding.triage && finding.triage.provenance === 'VERIFICATION') {
      summary.items.push({ findingId: finding.id, action: 'SKIPPED_VERIFICATION_PROVENANCE' });
      continue;
    }
    // GUARDA DE RECURSÃO: correção que reincide além do limite para de tentar e fica BLOCKED com
    // evidência (nunca laço infinito, nunca silêncio).
    if ((finding.recurrence_count || 0) >= MAX_FINDING_RECURRENCE) {
      await bugFindingService.blockFinding(finding.id, {
        actor,
        dependency: 'BUG_RECURSION_GUARD',
        evidence: [bugFindingService.makeEvidence({
          type: 'LOG_CORRELATION',
          ref: `recurrence:${finding.recurrence_count}`,
          detail: `finding reincidiu ${finding.recurrence_count}x (limite ${MAX_FINDING_RECURRENCE}) — a correção anterior não resolveu`,
          source: 'bugLoopCoordinatorService.runBugLoopSweep',
        })],
        minimumHumanAction: 'revisar por que a correção não resolveu: o bug voltou acima do limite de política',
        tenantId,
      });
      summary.blockedRecursive += 1;
      summary.items.push({ findingId: finding.id, action: 'BLOCKED_RECURSIVE_FAILURE', recurrenceCount: finding.recurrence_count });
      continue;
    }
    if (!finding.fix_task_id) {
      const outcome = await withFindingLease(finding.id, workerInstanceId, async () => {
        const triage = await bugTriageService.triage(finding.id, { actor, tenantId, allowedPaths, policy });
        if (triage.requiresHumanApproval || triage.requiresNonApplicationAction) {
          return {
            triaged: true,
            action: triage.requiresHumanApproval ? 'AWAITING_HUMAN_APPROVAL' : 'CONFIRMED_NON_APPLICATION_ACTION',
            taskId: triage.fixTask?.id || null,
            requiresHumanApproval: triage.requiresHumanApproval === true,
          };
        }
        if (!autoFix) return { triaged: true, action: 'TRIAGED', taskId: triage.fixTask?.id || null };
        const fix = await runFixLoop(finding.id, { actor, tenantId, maxAttempts });
        if (fix.blocked) return { action: 'AWAITING_HUMAN_APPROVAL', code: fix.code, requiresHumanApproval: true };
        return { action: 'FIX_LOOP', status: fix.finding?.status || null, closed: Boolean(fix.closed) };
      });
      if (outcome?.skipped) {
        summary.leaseSkipped += 1;
        summary.items.push({ findingId: finding.id, action: 'SKIPPED_LEASE_HELD', leaseWorker: outcome.lease?.worker || null });
        continue;
      }
      if (outcome.triaged) summary.triaged += 1;
      if (outcome.requiresHumanApproval) summary.awaitedApproval += 1;
      if (outcome.closed) summary.fixed += 1;
      summary.items.push({ findingId: finding.id, ...outcome });
      continue;
    }
    if (finding.status === 'FIXING' && autoFix) {
      const outcome = await withFindingLease(finding.id, workerInstanceId, async () => {
        const fix = await runFixLoop(finding.id, { actor, tenantId, maxAttempts });
        return { action: 'FIX_LOOP_RESUME', status: fix.finding?.status || null, closed: Boolean(fix.executed && fix.closed) };
      });
      if (outcome?.skipped) {
        summary.leaseSkipped += 1;
        summary.items.push({ findingId: finding.id, action: 'SKIPPED_LEASE_HELD', leaseWorker: outcome.lease?.worker || null });
        continue;
      }
      if (outcome.closed) summary.fixed += 1;
      summary.items.push({ findingId: finding.id, ...outcome });
    }
  }

  // ── RETOMADA DA MISSÃO ORIGINAL (caminho normal, sem chamada manual). Finding CLOSED com missão
  // vinculada faz a missão VOLTAR a executar pelo caminho canônico (`startExecution` → task
  // substituta sob lease). Idempotente pela linhagem persistida e resiliente a crash: se o processo
  // morreu entre o fechamento e o resume, o próximo worker assume e conclui.
  if (resumeMission) {
    const closedFindings = await bugFindingService.listFindings({ status: ['CLOSED'], limit });
    for (const finding of closedFindings) {
      if (!finding.mission_id) continue;
      const recorded = await isMissionResumeRecorded(finding.mission_id, finding.id);
      if (recorded) {
        summary.items.push({ findingId: finding.id, action: 'MISSION_RESUME_ALREADY_DONE' });
        continue;
      }
      const resume = await resumeOriginalMission({
        missionId: finding.mission_id,
        findingId: finding.id,
        fixTaskId: finding.fix_task_id || null,
        actor,
        tenantId,
      });
      if (resume.resumed) summary.resumed += 1;
      summary.items.push({
        findingId: finding.id,
        action: 'MISSION_RESUME',
        resumed: Boolean(resume.resumed),
        decision: resume.decision || null,
        replacementTaskId: resume.replacementTaskId || null,
        reason: resume.reason || null,
      });
    }
  }

  return summary;
}

/** Linhagem já registra a retomada deste finding? (idempotência do resume) */
async function isMissionResumeRecorded(missionId, findingId) {
  try {
    const mission = await missionStore.getMission(missionId);
    const recorded = mission?.resume_metadata?.bugLoop?.lineage?.findingId || null;
    return Boolean(recorded && recorded === findingId);
  } catch (err) {
    logger.warn('[bugLoopCoordinator] falha ao checar linhagem de retomada', { missionId, error: err.message });
    return false;
  }
}

module.exports = {
  PLATFORM_TENANT_ID,
  DEFAULT_MAX_FIX_ATTEMPTS,
  readRegressionRuns,
  readReviews,
  readTestRuns,
  runFixLoop,
  continueMission,
  resumeOriginalMission,
  withFindingLease,
  handleAnomaly,
  ingestTelemetry,
  diagnoseNoProgress,
  hookMissionFailure,
  runBugLoopSweep,
};
