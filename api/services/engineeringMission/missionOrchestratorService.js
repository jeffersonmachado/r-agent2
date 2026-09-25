'use strict';

/**
 * api/services/engineeringMission/missionOrchestratorService.js
 *
 * Ligação entre a mission APROVADA e a execução real do Engineer Model Router.
 *
 * Responsabilidades:
 *   - criar a EngineeringTask a partir da MissionSpec aprovada (idempotente por
 *     `mission:<id>:v<versão>` — um crash entre "criar task" e "gravar link" nunca duplica task);
 *   - iniciar a execução via `engineeringRouterService.runTask` (que já é durável e retomável);
 *   - refletir o estado real da task na missão, sem mentir (READY_FOR_PROMOTION ⇒ DEGRADED);
 *   - retomar missões interrompidas após restart, sem reiniciar do zero e sem reexecutar efeitos.
 *
 * Nenhum gate é relaxado aqui: a missão só chega a GREEN quando a task chega a GREEN pelos seus
 * próprios gates determinísticos.
 */

const { deriveDisplayStatus, toEngineeringTaskType } = require('../../../engine/engineeringMission/missionStatus');
const { MISSION_FAILURE_CODES } = require('../../../engine/engineeringMission/constants');
const missionStore = require('./missionStoreService');
const compiler = require('./missionCompilerService');
const approvalService = require('./missionApprovalService');
const missionReviewService = require('./missionReviewService');
const taskSpecBinding = require('./taskSpecBindingService');
const { emitMissionStage } = require('./missionEvents');
const engineeringTaskService = require('../engineeringRouter/engineeringTaskService');
const { runTask } = require('../engineeringRouter/engineeringRouterService');
const { TERMINAL_STATES } = require('../../../engine/engineeringRouter/constants');
const { SPEC_STRATEGIES } = require('../../../engine/engineeringMission/missionSpecFreshness');
const logger = require('../../utils/logger');

const DISPLAY_TO_MISSION_STATE = Object.freeze({
  RUNNING: 'EXECUTING',
  GREEN: 'GREEN',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  DEGRADED: 'DEGRADED',
});

/** Constrói o Task Contract a partir da MissionSpec aprovada — tradução de vocabulário apenas. */
function buildTaskContract(spec, { createdBy = null } = {}) {
  return {
    title: spec.objective || spec.originalMission.slice(0, 120),
    objective: spec.objective || spec.originalMission,
    taskType: toEngineeringTaskType(spec.missionType),
    risk: spec.risk,
    scope: spec.scope || 'MEDIUM',
    allowedPaths: spec.allowedPaths || [],
    forbiddenPaths: spec.forbiddenPaths || [],
    explicitPolicyAuthorization: spec.explicitPolicyAuthorization === true,
    acceptanceCriteria: (spec.acceptanceCriteria || []).map((c) => (typeof c === 'string' ? c : c.text)),
    testCommands: spec.testCommands || [],
    maxIterations: spec.maxIterations || undefined,
    releaseBlocker: spec.releaseBlocker === true,
    createdBy,
  };
}

/**
 * Cria (ou reaproveita, se já existir) a EngineeringTask da versão aprovada e marca EXECUTING.
 * Não dispara o loop de execução — isso é `runMissionTask`, para que a rota possa responder
 * imediatamente e o loop seguir em background (mesmo padrão do Router).
 */
/**
 * SUPERSEDE explícito (§23). Quando a execução passa a ser da versão NOVA, a task da versão
 * anterior não pode simplesmente continuar existindo em estado executável: ela é CANCELADA e
 * marcada com `superseded_by_task_id` — ou, se já produziu trabalho material, fica PENDENTE DE
 * DECISÃO HUMANA (nunca se destrói trabalho real em silêncio).
 */
async function supersedePreviousTask({ mission, newTaskId, actor = null, tenantId = 'system' }) {
  const previousTaskId = mission?.linked_task_id || null;
  if (!previousTaskId || previousTaskId === newTaskId) return null;

  const previous = await engineeringTaskService.getTask(previousTaskId);
  if (!previous || TERMINAL_STATES.includes(previous.status)) return null;

  const { assessment } = await taskSpecBinding.assessTaskSpecFreshness(previousTaskId);
  if (assessment.strategy === SPEC_STRATEGIES.PROCEED) return null;

  const outcome = await taskSpecBinding.resolveStaleTask(previousTaskId, {
    supersededByTaskId: newTaskId,
    actor,
    reason: assessment.reason,
  });
  emitMissionStage(tenantId, mission.id, {
    stage: 'TASK_SUPERSEDED',
    status: 'warning',
    phase: 'EXECUTING',
    displayStatus: null,
    message: `EngineeringTask ${previousTaskId} (vínculo ${assessment.state}) resolvida como ${outcome.applied}`,
    meta: { previousTaskId, newTaskId, state: assessment.state, strategy: assessment.strategy, applied: outcome.applied },
  });
  return outcome;
}

async function startExecution(missionId, { actor = null, tenantId = 'system' } = {}) {
  const { mission, spec, approval } = await approvalService.assertMissionExecutable(missionId);

  const task = await engineeringTaskService.createTask(
    buildTaskContract(spec, { createdBy: actor }),
    { createdBy: actor, idempotencyKey: `mission:${missionId}:v${spec.version}` },
  );

  // VÍNCULO VERIFICÁVEL (§22): a task passa a declarar DE QUAL versão da MissionSpec ela veio.
  // Sem isso, uma task da v1 continuava executando fases materiais depois da v2 aprovada e nenhuma
  // fase podia detectar o contrato obsoleto — o gap STALE_MISSION_SPEC.
  const binding = await taskSpecBinding.bindTaskToSpec({ taskId: task.id, missionId, spec, approval });

  // A task da versão anterior (se havia e se o contrato dela ficou obsoleto) é resolvida de forma
  // EXPLÍCITA antes do novo vínculo, para que não reste execução paralela sobre contrato antigo.
  const supersession = await supersedePreviousTask({ mission, newTaskId: task.id, actor, tenantId });

  await missionStore.linkTask({ missionId, taskId: task.id });
  await missionStore.updateMission(missionId, { status: 'EXECUTING' });
  await missionStore.mergeMissionJson(missionId, {
    resume: { phase: 'EXECUTING', taskId: task.id, missionVersion: spec.version, startedAt: new Date().toISOString() },
  });

  const detail = await compiler.getMissionDetail(missionId);
  emitMissionStage(tenantId, missionId, {
    stage: 'EXECUTION_STARTED',
    status: 'running',
    phase: 'EXECUTING',
    missionVersion: spec.version,
    approvalMode: approval.state,
    displayStatus: detail.displayStatus,
    message: `EngineeringTask ${task.id} vinculada à missão`,
    meta: { taskId: task.id, taskType: task.task_type, risk: task.risk },
  });
  return { mission: detail, task, approval };
}

/**
 * Executa a task da missão (awaited — para testes/E2E e para uso programático) e reflete o
 * resultado na missão. A rota HTTP chama isto em background.
 *
 * `credentialScope` NUNCA vem de quem chama a API (mesma regra do Router — ERV1-CLOSE-006): é
 * parâmetro de worker/teste, com o default do próprio Router quando omitido.
 */
async function runMissionTask(missionId, { tenantId = null, runnerId = undefined, credentialScope = undefined } = {}) {
  const mission = await missionStore.getMission(missionId);
  if (!mission) throw Object.assign(new Error(`mission ${missionId} não encontrada`), { code: 'not_found' });
  if (!mission.linked_task_id) {
    throw Object.assign(new Error('missão não possui EngineeringTask vinculada — chame startExecution antes'), {
      code: MISSION_FAILURE_CODES.MISSION_TASK_NOT_LINKED,
    });
  }

  // GUARD de fase material: a execução só começa se o contrato da task ainda corresponde à
  // versão corrente da MissionSpec. Se uma versão superadora existe, o erro carrega a ESTRATÉGIA
  // explícita (§23) em vez de deixar a task avançar sobre contrato obsoleto.
  await taskSpecBinding.assertTaskSpecFresh(mission.linked_task_id, { phase: 'EXECUTION_ENTRY', missionId });

  const result = await runTask(mission.linked_task_id, {
    // GUARD por fase: injetado aqui (o Router é genérico e não conhece missões). Revalida antes de
    // CODING, antes de retomar fase de avanço e antes de promover.
    specFreshnessGuard: ({ phase }) => taskSpecBinding.assertTaskSpecFresh(mission.linked_task_id, { phase, missionId }),
    ...(runnerId ? { runnerId } : {}),
    ...(credentialScope ? { credentialScope } : {}),
    ...(tenantId ? { eventAudienceTenantId: tenantId } : {}),
  });
  const detail = await refreshMissionState(missionId, { tenantId });
  return { result, mission: detail };
}

/**
 * Reconcilia o estado da missão com o estado REAL da task. Idempotente e seguro para rodar
 * quantas vezes for necessário (resume, UI, worker periódico).
 *
 * ENFORCEMENT do Meta Reviewer: o Meta Reviewer não tem autoridade final sobre GREEN — ele produz
 * findings. Mas um finding BLOCKER/REGRESSION da versão CORRENTE impede a declaração de GREEN:
 * nesse caso a missão fica BLOCKED com o motivo persistido. GREEN continua dependendo dos gates
 * reais; a revisão é um gate adicional, nunca um substituto.
 */
async function refreshMissionState(missionId, { tenantId = null } = {}) {
  const mission = await missionStore.getMission(missionId);
  if (!mission) return null;
  if (!mission.linked_task_id) return compiler.getMissionDetail(missionId);

  const task = await engineeringTaskService.getTask(mission.linked_task_id);
  if (!task) return compiler.getMissionDetail(missionId);

  const display = deriveDisplayStatus({ ...mission, status: mission.status === 'GREEN' ? 'GREEN' : 'EXECUTING' }, { status: task.status });
  let nextStatus = DISPLAY_TO_MISSION_STATE[display] || mission.status;
  const patch = { status: nextStatus, failure: mission.failure || null };

  if (nextStatus === 'GREEN') {
    const blocking = await missionReviewService.getBlockingReview(missionId, mission.current_version);
    if (blocking) {
      nextStatus = 'BLOCKED';
      patch.status = 'BLOCKED';
      patch.failure = {
        code: 'META_REVIEW_BLOCKED',
        reviewId: blocking.id,
        reviewKind: blocking.kind,
        findings: blocking.blockingFindings,
        at: new Date().toISOString(),
        note: 'GREEN recusado: revisão da versão corrente tem finding bloqueante',
      };
    }
  }

  if (['GREEN', 'FAILED', 'DEGRADED'].includes(nextStatus) && !mission.completed_at) patch.completed_at = new Date();
  if (nextStatus !== mission.status || patch.completed_at || patch.failure !== mission.failure) {
    await missionStore.updateMission(missionId, patch);
  }

  if (nextStatus !== mission.status) {
    emitMissionStage(tenantId || 'system', missionId, {
      stage: nextStatus,
      status: nextStatus === 'GREEN' ? 'success' : (nextStatus === 'EXECUTING' ? 'running' : 'error'),
      phase: 'EXECUTION',
      displayStatus: deriveDisplayStatus({ ...mission, status: nextStatus }, { status: task.status }),
      message: nextStatus === 'BLOCKED' && patch.failure?.code === 'META_REVIEW_BLOCKED'
        ? `missão bloqueada por review (${patch.failure.reviewKind}): ${patch.failure.findings.map((f) => f.id || f.checkId).join(', ')}`
        : `estado da missão atualizado para ${nextStatus} (task ${task.status})`,
      meta: { taskId: task.id, taskStatus: task.status, failure: patch.failure },
    });
  }
  return compiler.getMissionDetail(missionId);
}

/**
 * Retomada durável (§17). Após crash/restart:
 *   - missão em ENRICHING volta a enriquecer (o compilador é idempotente: reaproveita a versão já
 *     gravada se os fatos/spec forem os mesmos);
 *   - missão em EXECUTING apenas tem o estado reconciliado com a task real (o Router tem o
 *     próprio resume durável — a missão nunca reimplementa esse loop);
 *   - missão APROVADA mas sem task é (re)ligada à execução;
 *   - missão terminal é ignorada.
 * NUNCA inicia execução de missão sem aprovação válida para a versão corrente.
 */
async function resumeInterruptedMissions({ tenantId = 'system', limit = 50, autoStart = true } = {}) {
  const missions = await missionStore.findResumableMissions({ limit });
  const summary = { scanned: missions.length, enriched: 0, executed: 0, reconciled: 0, skippedLocked: 0, failed: 0, items: [] };

  for (const mission of missions) {
    try {
      if (mission.status === 'CREATED' || mission.status === 'ENRICHING') {
        await compiler.enrichMission(mission.id, { tenantId, actor: 'SYSTEM:RESUME' });
        summary.enriched += 1;
        summary.items.push({ missionId: mission.id, action: 'ENRICHED' });
        continue;
      }
      if (mission.status === 'APPROVED') {
        if (!mission.linked_task_id && autoStart) {
          await startExecution(mission.id, { tenantId, actor: 'SYSTEM:RESUME' });
          summary.executed += 1;
          summary.items.push({ missionId: mission.id, action: 'EXECUTION_STARTED' });
        } else {
          await refreshMissionState(mission.id, { tenantId });
          summary.reconciled += 1;
          summary.items.push({ missionId: mission.id, action: 'RECONCILED' });
        }
        continue;
      }
      if (mission.status === 'EXECUTING') {
        await refreshMissionState(mission.id, { tenantId });
        summary.reconciled += 1;
        summary.items.push({ missionId: mission.id, action: 'RECONCILED' });
      }
    } catch (err) {
      // Lock de um worker VIVO não é falha de retomada: é o sistema recusando-se a trabalhar em
      // duplicidade. Reportar como falha faria um sweep saudável parecer quebrado.
      if (err.code === 'MISSION_LOCKED_BY_OTHER_WORKER') {
        summary.skippedLocked += 1;
        summary.items.push({ missionId: mission.id, action: 'SKIPPED_LOCKED', lockedBy: err.lockedBy || null });
        continue;
      }
      summary.failed += 1;
      summary.items.push({ missionId: mission.id, action: 'FAILED', error: err.message, code: err.code || null });
      logger.warn('[missionOrchestrator] falha ao retomar missão', { missionId: mission.id, error: err.message });
      await missionStore.mergeMissionJson(mission.id, {
        resume: { lastError: { message: err.message, code: err.code || null, at: new Date().toISOString() } },
      }).catch(() => {});
    }
  }
  return summary;
}

module.exports = {
  DISPLAY_TO_MISSION_STATE,
  buildTaskContract,
  startExecution,
  runMissionTask,
  refreshMissionState,
  resumeInterruptedMissions,
};
