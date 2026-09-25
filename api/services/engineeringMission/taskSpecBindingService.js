'use strict';

/**
 * api/services/engineeringMission/taskSpecBindingService.js
 *
 * Vínculo verificável EngineeringTask ↔ MissionSpec e enforcement do frescor em fase material.
 *
 * Ver `engine/engineeringMission/missionSpecFreshness.js` para a decisão (motor puro). Aqui está
 * o lado de serviço: persistir o vínculo no momento da criação da task, derivar (backfill) quando
 * derivável, medir antes de cada fase material e aplicar a consequência explícita.
 *
 * Regra dura: uma fase material NUNCA roda sobre contrato obsoleto. Quando não pode rodar, o erro
 * carrega `state` + `strategy` (§23 — nunca abandono silencioso: substituir, reconciliar, cancelar
 * ou replanejar, cada um declarado).
 */

const { assessSpecFreshness, SPEC_STATES, SPEC_STRATEGIES, canRunMaterialPhase } = require('../../../engine/engineeringMission/missionSpecFreshness');
const { MISSION_FAILURE_CODES } = require('../../../engine/engineeringMission/constants');
const engineeringTaskService = require('../engineeringRouter/engineeringTaskService');
const missionStore = require('./missionStoreService');

const SPEC_BINDING_FAILURE_CODES = Object.freeze({
  MISSION_SPEC_STALE: 'MISSION_SPEC_STALE',
  MISSION_SPEC_UNBOUND: 'MISSION_SPEC_UNBOUND',
});

/** Grava o vínculo da task com a versão da spec que a originou. */
async function bindTaskToSpec({ taskId, missionId, spec, approval = null, checkedAt = new Date() }) {
  if (!spec || spec.version === undefined || spec.version === null) {
    throw Object.assign(new Error('não é possível vincular task sem versão de MissionSpec'), {
      code: SPEC_BINDING_FAILURE_CODES.MISSION_SPEC_UNBOUND,
    });
  }
  await engineeringTaskService.updateTaskFields(taskId, {
    mission_id: missionId,
    mission_version: Number(spec.version),
    mission_spec_hash: spec.specHash || null,
    mission_spec_state: SPEC_STATES.CURRENT,
    mission_spec_checked_at: checkedAt,
  });
  return {
    taskId,
    missionId,
    missionVersion: Number(spec.version),
    specHash: spec.specHash || null,
    approvalMode: approval?.state || null,
    derived: false,
  };
}

/**
 * Deriva o vínculo quando ele é DERIVÁVEL: a missão cujo `linked_task_id` é esta task, com versão
 * corrente persistida. Não inventa vínculo — se a missão não aponta para a task, não deriva.
 * A marca `derived` vai na evidência: o vínculo foi inferido, não declarado na criação.
 */
async function deriveBindingFromMissionLink(taskId) {
  const mission = await missionStore.findMissionByLinkedTask(taskId);
  if (!mission) return null;
  const current = await missionStore.getCurrentVersion(mission.id);
  if (!current || !current.spec) return null;
  await engineeringTaskService.updateTaskFields(taskId, {
    mission_id: mission.id,
    mission_version: Number(current.spec.version),
    mission_spec_hash: current.spec.specHash || null,
    mission_spec_state: SPEC_STATES.CURRENT,
    mission_spec_checked_at: new Date(),
  });
  return {
    taskId,
    missionId: mission.id,
    missionVersion: Number(current.spec.version),
    specHash: current.spec.specHash || null,
    derived: true,
  };
}

async function readBinding(taskId) {
  const task = await engineeringTaskService.getTask(taskId);
  if (!task) throw Object.assign(new Error(`task ${taskId} não encontrada`), { code: 'not_found' });
  const binding = task.mission_id
    ? {
      taskId,
      missionId: task.mission_id,
      missionVersion: task.mission_version,
      specHash: task.mission_spec_hash,
    }
    : null;
  return { task, binding };
}

/**
 * Mede o frescor do contrato da task. Faz backfill quando o vínculo é derivável (tasks criadas
 * antes da coluna existir); fora isso, reporta UNBOUND como estado explícito.
 */
async function assessTaskSpecFreshness(taskId, { missionId = null } = {}) {
  let { task, binding } = await readBinding(taskId);

  let derived = false;
  if (!binding) {
    const backfilled = await deriveBindingFromMissionLink(taskId);
    if (backfilled) {
      derived = true;
      binding = { taskId, missionId: backfilled.missionId, missionVersion: backfilled.missionVersion, specHash: backfilled.specHash };
      task = await engineeringTaskService.getTask(taskId);
    }
  }

  const resolvedMissionId = missionId || binding?.missionId || null;
  const mission = resolvedMissionId ? await missionStore.getMission(resolvedMissionId) : null;
  const currentVersion = resolvedMissionId ? await missionStore.getCurrentVersion(resolvedMissionId) : null;
  const currentSpec = currentVersion?.spec || null;

  const assessment = assessSpecFreshness({
    binding,
    currentSpec,
    taskStatus: task.status,
    activeTaskId: mission?.linked_task_id || null,
  });

  return { task, mission, currentSpec, binding, assessment, derived };
}

/**
 * Persiste o estado medido (evidência), sem sobrescrever o vínculo.
 */
async function recordSpecState(taskId, assessment, checkedAt = new Date()) {
  await engineeringTaskService.updateTaskFields(taskId, {
    mission_spec_state: assessment.state,
    mission_spec_checked_at: checkedAt,
  });
}

/**
 * GUARD de fase material. Chamado antes de qualquer trabalho com efeito real.
 *
 * @throws {Error} `MISSION_SPEC_STALE` (com `state`/`strategy`) ou `MISSION_SPEC_UNBOUND`
 */
async function assertTaskSpecFresh(taskId, { phase = null, missionId = null } = {}) {
  const { task, currentSpec, binding, assessment, derived } = await assessTaskSpecFreshness(taskId, { missionId });
  await recordSpecState(taskId, assessment);

  if (canRunMaterialPhase(assessment)) {
    return { ...assessment, binding, currentSpec, taskStatus: task.status, phase, derived };
  }

  const code = assessment.state === SPEC_STATES.UNBOUND
    ? SPEC_BINDING_FAILURE_CODES.MISSION_SPEC_UNBOUND
    : MISSION_FAILURE_CODES.MISSION_STALE_VERSION;

  throw Object.assign(
    new Error(assessment.reason),
    {
      code: SPEC_BINDING_FAILURE_CODES.MISSION_SPEC_STALE,
      failureCode: code,
      taskId,
      phase,
      state: assessment.state,
      strategy: assessment.strategy,
      binding,
      currentVersion: currentSpec?.version ?? null,
      evidence: assessment.evidence,
    },
  );
}

/**
 * Aplica a estratégia de resolução para uma task obsoleta. NÃO cria a task substituta (isso é do
 * orquestrador, que é quem cria tasks): aqui se encerra/marca com decisão registrada.
 *
 * @returns {Promise<{taskId:string, state:string, strategy:string, applied:string, supersededByTaskId:string|null}>}
 */
async function resolveStaleTask(taskId, { supersededByTaskId = null, actor = null, reason = null } = {}) {
  const { assessment, binding } = await assessTaskSpecFreshness(taskId);
  const strategy = assessment.strategy;

  if (strategy === SPEC_STRATEGIES.PROCEED) {
    return { taskId, state: assessment.state, strategy, applied: 'NONE', supersededByTaskId: null };
  }

  // SUPERSEDE só substitui se HOUVER substituto declarado. Com substituto, a task obsoleta é
  // CANCELADA e marcada (o trabalho dela é não-material por definição de SUPERSEDE — a versão
  // material cai em RECONCILE). Sem substituto informado, não há substituição: fica pendente.
  const cancels = strategy === SPEC_STRATEGIES.CANCEL
    || (strategy === SPEC_STRATEGIES.SUPERSEDE && Boolean(supersededByTaskId));
  if (cancels) {
    await engineeringTaskService.saveLastError(taskId, {
      code: SPEC_BINDING_FAILURE_CODES.MISSION_SPEC_STALE,
      message: reason || assessment.reason,
      state: assessment.state,
      strategy,
      actor,
    });
    await engineeringTaskService.transitionTask(taskId, 'CANCELLED');
    if (supersededByTaskId) {
      await engineeringTaskService.updateTaskFields(taskId, { superseded_by_task_id: supersededByTaskId });
    }
    await recordSpecState(taskId, assessment);
    return { taskId, state: assessment.state, strategy, applied: 'CANCELLED', supersededByTaskId: supersededByTaskId || null };
  }

  // RECONCILE / REPLAN / SUPERSEDE: não se destrói trabalho material sem decisão humana.
  // Registra o estado + estratégia pendente para que a superfície exija a decisão.
  await recordSpecState(taskId, assessment);
  await engineeringTaskService.saveLastError(taskId, {
    code: SPEC_BINDING_FAILURE_CODES.MISSION_SPEC_STALE,
    message: reason || assessment.reason,
    state: assessment.state,
    strategy,
    pendingDecision: true,
    actor,
  });
  return {
    taskId,
    state: assessment.state,
    strategy,
    applied: 'PENDING_DECISION',
    supersededByTaskId: supersededByTaskId || null,
    binding,
  };
}

module.exports = {
  SPEC_BINDING_FAILURE_CODES,
  bindTaskToSpec,
  deriveBindingFromMissionLink,
  assessTaskSpecFreshness,
  assertTaskSpecFresh,
  recordSpecState,
  resolveStaleTask,
};
