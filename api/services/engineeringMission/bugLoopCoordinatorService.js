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
// FONTE CANÔNICA dos estados terminais de task: a retomada da missão decide por ESTA lista
// (uma cópia local já divergiu e tratou `BLOCKED` como retomável — ver comentário em
// `resumeOriginalMission`).
const { TERMINAL_STATES: ROUTER_TERMINAL_TASK_STATES } = require('../../../engine/engineeringRouter/constants');
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

/**
 * GUARDA DE NÃO-CONVERGÊNCIA DA CORREÇÃO.
 *
 * DEFEITO REAL MEDIDO (2026-10-20, lote 5 do runner autoritativo): o worker global reexecutava
 * `runFixLoop` (2 tentativas reais do Router cada) para os MESMOS findings em `FIXING` a cada
 * tick de 1 s. Em 900 s foram 302 ciclos com `fixed=0`/`resumed=0`, e cada ciclo consumia o
 * runner compartilhado — a reprodução do finding NOVO criado pela suíte falhava por concorrência
 * (INCONCLUSIVE) e voltava para `SUSPECTED`, então a missão nunca era retomada. O laço parecia
 * vivo e não produzia progresso: retrabalho infinito sobre backlog que nunca converge.
 *
 * Um finding que já consumiu N ciclos completos de correção sem GREEN não vai convergir por
 * repetição imediata. Ele passa a `BLOCKED` com dependência e ação humana mínima declaradas —
 * auditável, nunca silencioso, e fora da janela do sweep para que trabalho NOVO tenha vez.
 */
const MAX_FIX_NOT_CONVERGING = (() => {
  const raw = Number(process.env.ENGINEERING_MAX_FIX_NOT_CONVERGING);
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
      exitCodes: Array.isArray(plain.exit_codes) ? plain.exit_codes : [],
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
/**
 * EXECUÇÃO DO FIX sob POSSE do finding.
 *
 * DEFEITO MEDIDO (2026-10-25, `governanceApprovalFullWorkerE2E` na bateria): depois do aval humano o
 * coder foi executado TRÊS vezes (`fixAttempts.length` esperado 1, recebido 3). Causa: `runFixLoop`
 * chegava por `handleAnomaly` SEM lease, então a varredura podia pegar o mesmo finding e rodar o fix
 * em paralelo — duplicação de efeitos exatamente no caminho que a missão manda impedir.
 *
 * A partir daqui o fix loop adquire o lease quando ninguém o detém; a varredura já o passa adiante.
 * Posse de outro worker ⇒ recusa explícita (`FINDING_LEASE_HELD_BY_OTHER_WORKER`), nunca execução dupla.
 */
async function runFixLoop(findingId, opcoes = {}) {
  const { findingLease = null, workerInstanceId = null, ...resto } = opcoes;
  const dono = await bugFindingService.withFindingLeaseOwned(
    findingId,
    { lease: findingLease, workerInstanceId },
    async ({ lease }) => executarFixLoop(findingId, { ...resto, findingLease: lease, workerInstanceId }),
  );
  if (dono && dono.skipped) {
    // Recusa por posse é evento OPERACIONAL: sem esta linha, um fix que NÃO rodou fica
    // indistinguível de um fix que rodou e não convergiu (mesmo `fixed:false`, causas opostas).
    logger.warn('[bugLoopCoordinator] fix recusado: finding sob posse de outro worker', {
      findingId, worker: dono.lease?.worker || null, expiresAt: dono.lease?.expiresAt || null,
    });
    return {
      finding: null,
      executed: false,
      fixed: false,
      blocked: true,
      stage: 'LEASE_HELD_BY_OTHER_WORKER',
      code: 'FINDING_LEASE_HELD_BY_OTHER_WORKER',
      reason: `finding ${findingId} está sob posse de outro worker — o fix não pode rodar em paralelo`,
      lease: dono.lease || null,
    };
  }
  return dono;
}

async function executarFixLoop(findingId, {
  actor = null, tenantId = null, maxAttempts = DEFAULT_MAX_FIX_ATTEMPTS,
  credentialScope = undefined, specFreshnessGuard = null, missionLease = null, secondaryFindings = [],
  findingLease = null,
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
    // CONTAGEM PERSISTIDA (não só log): é ela que distingue "ainda pode convergir" de
    // "vai repetir para sempre". Antes deste contador, o sweep reexecutava o ciclo completo
    // dos mesmos findings em todo tick (medido: 302 ciclos / 900 s, `fixed=0`).
    const recorded = await bugFindingService.recordFixNotGreen(findingId, {
      actor, taskStatus, attempts, reasonCode: lastResult?.reasonCode || null,
    });
    logger.warn('[bugLoopCoordinator] correção não chegou a GREEN', {
      findingId, taskStatus, attempts: attempts.length, fixAttempts: recorded.fixAttempts,
    });
    if (recorded.fixAttempts >= MAX_FIX_NOT_CONVERGING) {
      // BLOCKED exige dependência + ação humana mínima (contrato do serviço). A evidência carrega
      // o histórico das tentativas: quem for destravar não recomeça do zero.
      await bugFindingService.blockFinding(findingId, {
        actor,
        lease: findingLease,
        dependency: 'BUG_FIX_NOT_CONVERGING',
        evidence: [bugFindingService.makeEvidence({
          type: 'LOG_CORRELATION',
          ref: `fix-attempts:${recorded.fixAttempts}`,
          detail: `${recorded.fixAttempts} ciclo(s) de correção terminaram em ${taskStatus || 'UNKNOWN'} sem GREEN (limite ${MAX_FIX_NOT_CONVERGING})`,
          source: 'bugLoopCoordinatorService.runFixLoop',
        })],
        minimumHumanAction: 'inspecionar por que a correção não fecha GREEN (contrato da task, sandbox, provider) e reabrir o finding com o motivo',
        tenantId,
      });
      logger.warn('[bugLoopCoordinator] finding BLOQUEADO por não-convergência da correção', {
        findingId, fixAttempts: recorded.fixAttempts, limit: MAX_FIX_NOT_CONVERGING,
      });
      return {
        finding: await bugFindingService.getFinding(findingId),
        executed: true,
        fixed: false,
        stage: 'BLOCKED_NOT_CONVERGING',
        code: 'BUG_FIX_NOT_CONVERGING',
        taskStatus,
        attempts,
        fixAttempts: recorded.fixAttempts,
      };
    }
    return { finding: await bugFindingService.getFinding(findingId), executed: true, fixed: false, stage: 'NOT_GREEN', taskStatus, attempts, fixAttempts: recorded.fixAttempts };
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

  // ── GOVERNANÇA ANTES DE DECLARAR FIXED ──────────────────────────────────────────────────────
  // ORDEM CORRETA (a missão de 2026-10-03 exige explicitamente): patch/testes/review GREEN ⇒
  // verificar o baseline de governança ⇒ SÓ ENTÃO declarar FIXED ⇒ regressão ⇒ close.
  //
  // DEFEITO ELIMINADO: a verificação vinha DEPOIS de `markFixed`. Um fix que legitimamente alterava
  // uma regra de julgamento deixava o finding em `FIXED` aguardando aval humano — um estado que
  // mente (FIXED afirma ciclo concluído) e que deixava o finding ÓRFÃO: `runBugLoopSweep` só varre
  // CONFIRMED/FIXING, então nenhum aval humano posterior voltava a ser visto pelo worker.
  //
  // Agora o finding PERMANECE `FIXING` com motivo de bloqueio persistido (`GOVERNANCE_APPROVAL_
  // REQUIRED`) e o checkpoint do que já foi feito. O worker o re-seleciona sozinho e, após o aval,
  // continua daqui — sem reexecutar o coder, porque o patch/testes/review continuam registrados.
  let baselineVerdict = null;
  if (finding.self_modification) {
    baselineVerdict = await bugTriageService.verifySelfModificationBaseline(findingId, { actor });
    if (!baselineVerdict.ok) {
      const blockedFinding = await bugFindingService.markPendingGovernanceApproval(findingId, {
        actor,
        code: baselineVerdict.code || 'GOVERNANCE_APPROVAL_REQUIRED',
        reason: baselineVerdict.reason,
        verification: {
          ok: baselineVerdict.ok,
          checked: baselineVerdict.checked,
          code: baselineVerdict.code,
          diff: baselineVerdict.diff || null,
        },
        evidence: [bugFindingService.makeEvidence({
          type: 'LOG_CORRELATION',
          ref: `governance-approval:${findingId}`,
          detail: `fix GREEN (task ${finding.fix_task_id}) bloqueado por governança: ${baselineVerdict.code || 'GOVERNANCE_APPROVAL_REQUIRED'}`,
          source: 'bugLoopCoordinatorService.runFixLoop',
        })],
      });
      logger.warn('[bugLoopCoordinator] fix de self-modification afrouxa o próprio critério — aguardando aval humano (finding permanece FIXING)', {
        findingId, code: baselineVerdict.code,
      });
      return {
        finding: blockedFinding,
        executed: true,
        fixed: false,
        closed: false,
        blocked: true,
        stage: 'AWAITING_GOVERNANCE_APPROVAL',
        blockingReason: 'GOVERNANCE_APPROVAL_REQUIRED',
        code: baselineVerdict.code,
        baseline: baselineVerdict,
        checkpoint: { status: blockedFinding?.status || 'FIXING', fixTaskId: finding.fix_task_id, fixApplied: true },
        taskStatus,
        attempts,
      };
    }
  }

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
      lease: findingLease,
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

  // ── SELF-MODIFICATION: a verificação de baseline de governança ACONTECEU ACIMA, ANTES de
  // declarar FIXED (é a ordem correta). Aqui o finding já está autorizado: se o baseline tivesse
  // sido violado sem aval, o fluxo teria retornado em AWAITING_GOVERNANCE_APPROVAL sem marcar FIXED.

  // ── REGRESSÃO: só com execuções REAIS do fix task ────────────────────────────────────────────
  const runs = await readRegressionRuns(finding.fix_task_id);
  let regressionValidated = false;
  let regressionError = null;
  try {
    await bugFindingService.markRegressionValidated(findingId, { actor, runs, tenantId, lease: findingLease });
    regressionValidated = true;
  } catch (err) {
    regressionError = { code: err.code, message: err.message };
    logger.warn('[bugLoopCoordinator] regressão não validada', { findingId, code: err.code, message: err.message });
  }

  let closed = false;
  if (regressionValidated) {
    try {
      // ── ENGINEERING MEMORY (2026-10-08) ──────────────────────────────────────────────────────
      // INCIDENT → ROOT_CAUSE → KNOWN_PROBLEM → PREVENTIVE_RULE → EXECUTABLE_TEST → REGRESSION →
      // VERIFIED. O registro é montado a partir do estado REAL do finding (nada inventado) e só é
      // ATIVADO aqui, quando a regressão já foi validada com execuções reais — antes disso ele
      // permanece PROPOSED, e regra preventiva PROPOSED nunca é imposta (memória não verificada não
      // vira obrigação).
      //
      // Ordem importa: registrar ANTES de fechar, porque `closeFinding` recusa o fechamento de
      // findings de SELF_MODIFICATION ou REINCIDENTES sem prevenção ativa e verificada.
      const fresh = await bugFindingService.getFinding(findingId);
      // Os runs REAIS de regressão desta tentativa entram no problema conhecido: é
      // a execução que prova que o teste preventivo existe, roda e passa (sem ela a
      // ativação é recusada com PREVENTIVE_RULE_TEST_NOT_EXECUTED).
      const knownProblem = bugFindingService.buildKnownProblemFromFinding(fresh, { actor, regressionRuns: runs });
      const activeKnownProblem = engine.activate(knownProblem, {
        findingStatus: 'REGRESSION_VALIDATED',
        now: new Date().toISOString(),
      });
      await bugFindingService.recordKnownProblem(findingId, activeKnownProblem, { tenantId });
    } catch (err) {
      logger.warn('[bugLoopCoordinator] problema conhecido não registrado', {
        findingId, code: err.code, message: err.message,
      });
    }
    try {
      await bugFindingService.closeFinding(findingId, { actor, reason: 'reprodução verde + testes + parecer + regressão', tenantId, lease: findingLease });
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
async function resumeOriginalMission({ missionId, findingId = null, fixTaskId = null, actor = null, tenantId = null, execute = true, allowSourceReplan = true } = {}) {
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
      // ESTADOS TERMINAIS DA TASK — DERIVADOS DA FONTE CANÔNICA DO ROUTER, NUNCA UMA LISTA LOCAL.
      //
      // DEFEITO REAL MEDIDO (2026-10-20, lote 5 do runner autoritativo): a lista local era
      // `['RED','GREEN','FAILED','CANCELLED','READY_FOR_PROMOTION']` — ela OMITIA `BLOCKED`, que é
      // estado TERMINAL do Router (`engine/engineeringRouter/constants.js::TERMINAL_STATES`), e
      // incluía `FAILED`, que o Router nunca usa. Consequência medida: a task original terminava
      // `BLOCKED` (ex.: `SANDBOX_UNAVAILABLE`), a retomada caía no ramo "task ainda executável",
      // chamava `startExecution`, recebia a MESMA task de volta (idempotência) e registrava
      // `replacementTaskId === originalTaskId`. A missão nunca voltava a executar e a suíte
      // (corretamente) falhava em `expect(replacementTaskId).not.toBe(originalTaskId)`.
      // Duplicar a lista é o que permitiu a divergência; agora ela vem do próprio Router.
      const TERMINAL_TASK_STATUSES = new Set([...ROUTER_TERMINAL_TASK_STATES, 'FAILED']);
      let replacementTaskId = null;
      if (originalTask && TERMINAL_TASK_STATUSES.has(String(originalTask.status))) {
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
          // Mesma natureza da task inicial da missão: o spec nasce com
          // `allowedPaths: []` e o escopo é resolvido no planejamento. Sem a
          // declaração, a retomada pós-bug não conseguiria criar a task
          // substituta (regressão medida em 2026-10-13).
          scopeDeferred: true,
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
      const resumedRun = await orch.runMissionTask(missionId, { tenantId, allowSourceReplan, ...(lease ? { missionLease: lease } : {}) })
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
 * REPLAN DE FONTE LIMITADO — a ação que faltava quando o candidate fica STALE.
 *
 * DEFEITO ELIMINADO (2026-10-03): a task stale terminava `READY_FOR_PROMOTION` com
 * `reasonCode=STALE_CANDIDATE`; `hookMissionFailure` classificava corretamente como
 * `MISSION_SOURCE` (sem abrir bug de aplicação) — e PARAVA AÍ. Como `MISSION_SOURCE` é categoria de
 * NÃO-aplicação, nenhuma fix task nascia e NENHUM replan acontecia: a missão seguia `EXECUTING`
 * sem atividade nenhuma. Classificação sem comportamento.
 *
 * O replan REUSA o caminho canônico (`resumeOriginalMission`): cria a task substituta ANCORADA no
 * commit CORRENTE da fonte (`missionCurrentCommit`, já contendo as integrações que causaram o
 * avanço) e a executa pelo Router. É o "reancorar e reaplicar" da estratégia declarada — sem
 * executor de rebase paralelo e sem merge silencioso.
 *
 * TRÊS FRONTEIRAS, todas declaradas:
 *   - `REPLAN`                → reancora e reaplica (limitado por `SOURCE_REPLAN_POLICY.maxAttempts`);
 *   - `CONFLICT_TASK`         → a reaplicação conflitou: NÃO finge sucesso (estado
 *                               `SOURCE_REPLAN_CONFLICT`), exige task de resolução;
 *   - `BLOCKED_MAX_ATTEMPTS`  → esgotou: para de insistir (anti-laço infinito) e exige humano.
 *
 * IDEMPOTENTE por task: a mesma task não dispara dois replans (o contador vive no `resume_metadata`
 * da missão, sobrevivendo a restart — é o que torna o limite efetivo entre processos).
 */
/**
 * O replan EXECUTOU de fato? (não apenas "foi tentado")
 *
 * `resumeOriginalMission` devolve `{resumed:false, reason, code}` quando a missão
 * não é executável (política/aprovação) e pode lançar exceção. Nos dois casos a
 * tentativa foi consumida — e o contador DEVE continuar subindo —, mas nada foi
 * replanejado. Declarar `replanned: true` nesses casos é falso sucesso.
 *
 * @param {{resumed?: boolean, replacementTaskId?: string|null}|null} resumed
 * @returns {boolean}
 */
function replanExecutou(resumed) {
  return Boolean(resumed && resumed.resumed === true);
}

async function maybeReplanAfterSourceFailure({ missionId, taskId = null, result = null, actor = null, tenantId = null } = {}) {
  if (!missionId) return { replanned: false, reason: 'MISSION_ID_REQUIRED' };
  const { classifySourceFailure, planSourceReplan, SOURCE_REPLAN_POLICY } = require('../../../engine/engineeringMission/missionSource');
  const integration = (result && result.missionIntegration) || {};
  const sourceFailure = classifySourceFailure({
    reasonCode: (result && result.reasonCode) || integration.code || null,
    candidateBaseCommit: integration.candidateBaseCommit || (result && result.candidateBaseCommit) || null,
    missionCurrentCommit: integration.missionCommitBefore || null,
    reapplyConflicts: integration.code === 'MISSION_SOURCE_REPLAN_CONFLICT',
  });
  if (!sourceFailure.requiresReplan) {
    return { replanned: false, reason: 'NOT_SOURCE_FAILURE', code: sourceFailure.code };
  }

  const mission = await missionStore.getMission(missionId);
  if (!mission) return { replanned: false, reason: 'mission_not_found', missionId };
  const state = (mission.resume_metadata && mission.resume_metadata.sourceReplan) || {};
  const attempts = Number(state.attempts || 0);

  // IDEMPOTÊNCIA: o mesmo taskId não gera dois replans (o hook pode rodar mais de uma vez para a
  // mesma falha — retomada, reconciliação, worker periódico).
  if (state.lastTaskId && taskId && String(state.lastTaskId) === String(taskId) && state.state === 'REPLAN_SUCCEEDED') {
    return { replanned: false, reason: 'ALREADY_REPLANNED_FOR_TASK', attempts };
  }

  const maxAttempts = Number(process.env.ENGINEERING_MISSION_MAX_SOURCE_REPLAN || 0) || SOURCE_REPLAN_POLICY.maxAttempts;
  const replanConflicts = integration.code === 'MISSION_SOURCE_REPLAN_CONFLICT';
  const plan = planSourceReplan({
    requiresReplan: true,
    disposition: sourceFailure.disposition,
    attempts,
    maxAttempts,
    reapplyConflicts: replanConflicts,
  });

  const history = [
    ...(Array.isArray(state.history) ? state.history : []),
    { at: new Date().toISOString(), taskId, code: sourceFailure.code, disposition: sourceFailure.disposition, action: plan.action },
  ].slice(-20);

  const persist = (patch) => missionStore.mergeMissionJson(missionId, {
    resume: { sourceReplan: { attempts, maxAttempts, history, lastTaskId: taskId, lastCode: sourceFailure.code, ...patch } },
  }).catch((err) => logger.warn('[bugLoopCoordinator] falha ao persistir estado de replan de fonte', { missionId, error: err.message }));

  const loop = [];
  if (plan.action === 'CONFLICT_TASK') {
    await persist({ state: 'SOURCE_REPLAN_CONFLICT', code: plan.code, reason: plan.reason, conflicts: true });
    logger.warn('[bugLoopCoordinator] replan de fonte CONFLITOU — sem sucesso falso; exige task de resolução', {
      missionId, taskId, code: sourceFailure.code, reason: plan.reason,
    });
    return { replanned: false, state: 'SOURCE_REPLAN_CONFLICT', code: plan.code, reason: plan.reason, sourceFailure, plan };
  }

  if (plan.action === 'BLOCKED_MAX_ATTEMPTS') {
    await persist({ state: 'SOURCE_REPLAN_EXHAUSTED', code: plan.code, reason: plan.reason });
    logger.error('[bugLoopCoordinator] replan de fonte ESGOTADO — parando de insistir (anti-laço infinito)', {
      missionId, taskId, attempts, maxAttempts, reason: plan.reason,
    });
    return { replanned: false, state: 'SOURCE_REPLAN_EXHAUSTED', code: plan.code, reason: plan.reason, attempts, maxAttempts, sourceFailure, plan };
  }

  // ---- REPLAN: reancora na fonte CORRENTE e reaplica pelo caminho canônico -------------------
  // O contador é persistido ANTES de executar: se o processo morrer no meio, a tentativa já conta
  // (senão um crash a cada execução permitiria replan infinito).
  const nextAttempt = plan.attempt;
  await persist({ attempts: nextAttempt, state: 'REPLAN_RUNNING' });

  let resumed = null;
  let error = null;
  try {
    // `allowSourceReplan: false` — ESTE laço é o dono da decisão. Sem isso, a execução interna
    // chamaria o replan de novo e a recursão esconderia o contador.
    resumed = await resumeOriginalMission({ missionId, actor, tenantId, execute: true, allowSourceReplan: false });
  } catch (err) {
    error = { code: err.code || null, message: err.message };
  }
  loop.push({ attempt: nextAttempt, status: resumed && resumed.status || null, error });

  const succeeded = Boolean(resumed && resumed.status === 'GREEN');

  // ── EFEITO, NÃO TENTATIVA (defeito medido 2026-10-17) ──────────────────────
  // `replanned: true` era devolvido mesmo quando `resumeOriginalMission`
  // respondia `resumed: false` (missão não executável / bloqueio de política) ou
  // lançava: a tentativa tinha sido FEITA, mas nada foi replanejado — e o
  // chamador logava "missão replanejada" sem `replacementTaskId`. É a mesma
  // classe de falso verde que a missão proíbe: declarar sucesso sem efeito.
  // O contador de tentativas continua sendo consumido (é o que impede loop
  // infinito); o que muda é a DECLARAÇÃO.
  const executou = replanExecutou(resumed);
  await persist({
    state: succeeded ? 'REPLAN_SUCCEEDED' : (error ? 'REPLAN_ERROR' : 'REPLAN_RAN'),
    attempts: nextAttempt,
    lastStatus: (resumed && resumed.status) || null,
    lastError: error,
    replacementTaskId: (resumed && resumed.replacementTaskId) || null,
    loop,
  });

  logger.info('[bugLoopCoordinator] replan de fonte executado', {
    missionId, taskId, attempt: nextAttempt, maxAttempts,
    replacementTaskId: resumed && resumed.replacementTaskId, status: resumed && resumed.status, error,
  });

  return {
    replanned: executou,
    attempted: true,
    attempt: nextAttempt,
    maxAttempts,
    state: succeeded ? 'REPLAN_SUCCEEDED' : (executou ? 'REPLAN_RAN' : 'REPLAN_NAO_EXECUTOU'),
    status: (resumed && resumed.status) || null,
    replacementTaskId: (resumed && resumed.replacementTaskId) || null,
    decision: (resumed && resumed.decision) || null,
    reason: (resumed && resumed.reason) || null,
    error,
    sourceFailure,
    plan,
  };
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
      // O `lease` repassado é de OUTRO finding por construção (o finding aqui é recém-registrado), então
      // não é herdado: `reproduce` adquire a posse do finding novo. Recusa por posse devolve
      // `finding: null` — tratada explicitamente, nunca desreferenciada.
      const reproduction = await bugReproductionService.reproduce(finding.id, { actor, tenantId, runner, invariantResults });
      report.reproduced = reproduction.outcome;
      if (reproduction.skipped || !reproduction.finding) {
        report.outcome = reproduction.outcome || 'SKIPPED_LEASE_HELD';
        report.skipped = true;
        return report;
      }
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

  // ------------------------------------------------------- FALHA DE FONTE ≠ BUG DE APLICAÇÃO
  // DEFEITO ELIMINADO (2026-10-03): qualquer não-GREEN abria finding com `source:'EXCEPTION'`, que
  // `inferCategory` mapeia para BUG e `requiresApplicationFix(true)` aceita. Assim um candidate
  // STALE — "a fonte da missão avançou enquanto a task codava" — virava fix task de APLICAÇÃO e
  // gastava um ciclo autônomo inteiro de coder+review+regressão perseguindo um defeito inexistente
  // no produto. `classifySourceFailure` é pura e decide a origem; `classifyStaleCandidateDisposition`
  // já descrevia exatamente este caso e nunca estava ligada ao hook.
  const { classifySourceFailure } = require('../../../engine/engineeringMission/missionSource');
  const sourceFailure = classifySourceFailure({
    reasonCode: result.reasonCode || null,
    candidateBaseCommit: extra.candidateBaseCommit || null,
    missionCurrentCommit: extra.missionCurrentCommit || null,
    reapplyConflicts: extra.reapplyConflicts === true,
  });
  if (sourceFailure.isSourceFailure) {
    logger.warn('[bugLoopCoordinator] falha da camada de FONTE — não abre correção de aplicação', {
      missionId,
      taskId,
      code: sourceFailure.code,
      disposition: sourceFailure.disposition,
    });
  }

  return bugFindingService.registerFinding({
    missionId,
    taskId,
    provenance,
    source: sourceFailure.isSourceFailure ? 'MISSION_SOURCE' : (extra.source || 'EXCEPTION'),
    title,
    description: sourceFailure.isSourceFailure
      ? `${sourceFailure.reason} (código ${sourceFailure.code}; disposição ${sourceFailure.disposition})`
      : (extra.description || `resultado real da execução: ${status}`),
    expectedBehavior: 'a task da missão conclui em GREEN pelos seus próprios gates',
    observedBehavior: `status=${status}${result.reasonCode ? ` reasonCode=${result.reasonCode}` : ''}`,
    category: sourceFailure.isSourceFailure ? 'MISSION_SOURCE' : (extra.category || undefined),
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
 * POSSE DURÁVEL de um finding durante a varredura — DELEGAÇÃO, não segunda implementação.
 *
 * DEFEITO MEDIDO (2026-10-26, revisão adversarial): existiam DUAS implementações do mesmo ciclo
 * (adquirir → heartbeat → liberar → fence) — esta e `bugFindingService.withFindingLeaseOwned` — com
 * semânticas divergentes (aqui, `workerInstanceId` ausente rodava SEM posse; lá, sem identidade
 * declarada a operação adquiria a própria). Duas cópias do ciclo de vida significam duas chances de
 * divergir: a segunda já não tinha o vínculo `lease.findingId` que a primeira ganhou.
 *
 * A autoridade única passou a ser `withFindingLeaseOwned`; esta função preserva o contrato do
 * chamador (varredura administrativa sem identidade roda SEM posse, explicitamente) e devolve a
 * mesma forma de recusa (`{ skipped, code, lease }`).
 */
async function withFindingLease(findingId, workerInstanceId, fn, { ttlMs = null } = {}) {
  if (!workerInstanceId) return fn({ lease: null });
  return bugFindingService.withFindingLeaseOwned(findingId, { workerInstanceId, ttlMs }, fn);
}

async function runBugLoopSweep({
  limit = 10, actor = 'SYSTEM:BUG_LOOP', tenantId = null, autoFix = true,
  runner = bugReproductionService.defaultRunner, invariantResults = null, maxAttempts = DEFAULT_MAX_FIX_ATTEMPTS,
  allowedPaths = null, policy = null, resumeMission = true, workerInstanceId = null,
  // ESCOPO EXPLÍCITO (§9.3-quater da evidência da missão): sem esta opção a varredura é GLOBAL — o que é
  // o comportamento de produção — e o custo cresce com o estado acumulado da tabela (medido: BUG-02
  // levava 53,8 s de 60 s de orçamento só varrendo findings alheios). Com `findingIds` a operação fica
  // limitada aos findings pedidos, e quem varre um conjunto conhecido não reprocessa o resto.
  findingIds = null,
} = {}) {
  const summary = { scanned: 0, confirmed: 0, triaged: 0, fixed: 0, awaitedApproval: 0, resumed: 0, blockedRecursive: 0, leaseSkipped: 0, items: [] };
  // SEMÂNTICA FECHADA: ausência de escopo (`null`/`undefined`) = varredura GLOBAL, explícita. Lista
  // VAZIA não pode virar "o mundo inteiro" — quem pediu nenhum finding recebe nenhum (fail-closed), e
  // tipo inválido é erro de contrato, não varredura global silenciosa.
  if (findingIds !== null && findingIds !== undefined && !Array.isArray(findingIds)) {
    const err = new Error('`findingIds` deve ser array de ids ou null para varredura global');
    err.code = 'INVALID_SWEEP_SCOPE';
    err.detail = { findingIdsType: typeof findingIds };
    throw err;
  }
  const escopoVazio = Array.isArray(findingIds) && findingIds.length === 0;
  if (escopoVazio) return summary;
  const escopo = Array.isArray(findingIds) ? { ids: findingIds } : {};

  const pending = await bugFindingService.listFindings({ status: ['SUSPECTED', 'REPRODUCING'], limit, ...escopo });
  for (const finding of pending) {
    summary.scanned += 1;
    const owned = await withFindingLease(finding.id, workerInstanceId, async ({ lease }) => {
      const plan = bugReproductionService.buildPlan(finding);
      if (plan.kind === 'UNAVAILABLE') {
        // Motivo EXPLÍCITO persistido na derivação: nunca um silêncio que finge ausência de plano.
        return { action: 'NO_REPRODUCTION_PLAN', detail: finding.reproduction?.derivation?.reason || plan.rationale || null };
      }
      // O LEASE DA VARREDURA é passado adiante: `reproduce`/`confirmFinding` são donos da posse e não
      // podem readquiri-la com outra identidade (fariam a própria varredura ser recusada — medido no
      // E2E do caminho natural, que parava de progredir).
      const reproduction = await bugReproductionService.reproduce(finding.id, { actor, tenantId, runner, invariantResults, lease });
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

  const confirmed = await bugFindingService.listFindings({ status: ['CONFIRMED', 'FIXING'], limit, ...escopo });
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
      const outcome = await withFindingLease(finding.id, workerInstanceId, async ({ lease }) => {
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
        const fix = await runFixLoop(finding.id, { actor, tenantId, maxAttempts, findingLease: lease });
        if (fix.blocked) {
          return {
            action: fix.stage === 'AWAITING_GOVERNANCE_APPROVAL' ? 'AWAITING_GOVERNANCE_APPROVAL' : 'AWAITING_HUMAN_APPROVAL',
            code: fix.code,
            blockingReason: fix.blockingReason || null,
            requiresHumanApproval: true,
          };
        }
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
      const outcome = await withFindingLease(finding.id, workerInstanceId, async ({ lease }) => {
        const fix = await runFixLoop(finding.id, { actor, tenantId, maxAttempts, findingLease: lease });
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
    const closedFindings = await bugFindingService.listFindings({ status: ['CLOSED'], limit, ...escopo });
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
  MAX_FIX_NOT_CONVERGING,
  readRegressionRuns,
  readReviews,
  readTestRuns,
  runFixLoop,
  continueMission,
  resumeOriginalMission,
  maybeReplanAfterSourceFailure,
  replanExecutou,
  withFindingLease,
  handleAnomaly,
  ingestTelemetry,
  diagnoseNoProgress,
  hookMissionFailure,
  runBugLoopSweep,
};
