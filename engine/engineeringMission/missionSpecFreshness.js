'use strict';

/**
 * engine/engineeringMission/missionSpecFreshness.js — FRESCOR DA MissionSpec (§22, §23).
 *
 * Achado real da auditoria V2 (medido em 2026-09-25): a `EngineeringTask` NÃO guardava vínculo
 * algum com a versão da MissionSpec que a originou — nem `mission_id`, nem `mission_version`, nem
 * `spec_hash`. Consequência: uma task criada para a v1 continuava executando (CODING → TESTING →
 * REVIEWING → REGRESSION → GOVERNANCE → PROMOTING, com efeito REAL no git) depois de a missão já
 * estar na v2 aprovada, sem que nenhuma fase material pudesse detectar que o contrato executado
 * ficou obsoleto.
 *
 * Este módulo decide, de forma DETERMINÍSTICA e explícita, se a task pode avançar e — quando não
 * pode — QUAL é a estratégia (§23: nunca "abandonar em silêncio"):
 *
 *   PROCEED     vínculo confere com a versão corrente: a fase material pode rodar
 *   REPLAN      task sem vínculo derivável: não há como afirmar o que ela executa → reenriquecer
 *   SUPERSEDE   existe versão superadora e a task ainda não produziu fase material: substituir
 *   RECONCILE   existe versão superadora e a task JÁ produziu fase material: decisão humana
 *   CANCEL      a task foi substituída por outra (a missão aponta para task diferente): encerrar
 *
 * Módulo PURO: sem relógio, sem banco, sem rede, sem random. A evidência de tempo vem de quem
 * chama.
 */

/** Estados de frescor do vínculo. */
const SPEC_STATES = Object.freeze({
  CURRENT: 'CURRENT',
  STALE: 'STALE',
  SUPERSEDED: 'SUPERSEDED',
  UNBOUND: 'UNBOUND',
});

/** Estratégias explícitas de resolução (nunca "abandono silencioso"). */
const SPEC_STRATEGIES = Object.freeze({
  PROCEED: 'PROCEED',
  REPLAN: 'REPLAN',
  RECONCILE: 'RECONCILE',
  SUPERSEDE: 'SUPERSEDE',
  CANCEL: 'CANCEL',
});

/** Fases em que a task já produziu trabalho real (diff, testes, promoção). */
const MATERIAL_PHASES = Object.freeze([
  'CODING',
  'TESTING',
  'REVIEWING',
  'REGRESSION',
  'GOVERNANCE',
  'PROMOTING',
  'POST_PROMOTION_VERIFY',
  'READY_FOR_PROMOTION',
  'GREEN',
]);

/** Estados terminais: nada a decidir sobre avanço (o resultado já é histórico). */
const TERMINAL_PHASES = Object.freeze(['GREEN', 'RED', 'CANCELLED', 'BLOCKED']);

function isMaterialPhase(status) {
  return MATERIAL_PHASES.includes(status);
}

function isTerminalPhase(status) {
  return TERMINAL_PHASES.includes(status);
}

/**
 * Avalia o frescor do vínculo task↔spec.
 *
 * @param {Object} params
 * @param {Object|null} params.binding      `{ missionId, missionVersion, specHash }` persistido na task
 * @param {Object|null} params.currentSpec  spec corrente da missão (`{ version, specHash }`)
 * @param {string} [params.taskStatus]      status corrente da task
 * @param {string|null} [params.activeTaskId] `mission.linked_task_id` — a task que a missão considera ATIVA
 * @returns {{ state:string, strategy:string, material:boolean, reason:string, evidence:Object }}
 */
function assessSpecFreshness({ binding = null, currentSpec = null, taskStatus = null, activeTaskId = null } = {}) {
  const material = isMaterialPhase(taskStatus);
  const terminal = isTerminalPhase(taskStatus);
  // REGRA ÚNICA (evita tratamentos divergentes por ramo — o defeito real que este módulo teve):
  // o ESTADO descreve o vínculo (fato); a ESTRATÉGIA descreve a ação necessária. Uma task já
  // terminal não vai executar nada, então nenhuma ação é necessária — qualquer que seja o estado
  // do vínculo. O estado continua sendo reportado, porque é evidência histórica relevante.
  const finalize = (state, strategy, reason, evidence) => ({
    state,
    strategy: terminal ? SPEC_STRATEGIES.PROCEED : strategy,
    material,
    reason: terminal ? `${reason} (task em estado terminal: nada a executar)` : reason,
    evidence,
  });

  // Task sem vínculo: não há como afirmar QUAL contrato ela executa. Para uma task que já produziu
  // trabalho material, substituir seria destrutivo — a decisão é reenriquecer/reconciliar.
  if (!binding || !binding.missionId || binding.missionVersion === undefined || binding.missionVersion === null) {
    return finalize(
      SPEC_STATES.UNBOUND,
      material ? SPEC_STRATEGIES.RECONCILE : SPEC_STRATEGIES.REPLAN,
      material
        ? 'task sem vínculo com MissionSpec e já com trabalho material produzido — requer decisão humana'
        : 'task sem vínculo com MissionSpec: não é possível afirmar qual contrato ela executa',
      { taskStatus, binding: null },
    );
  }

  // A missão já aponta para OUTRA task ⇒ esta foi substituída. Não pode avançar fase material.
  if (activeTaskId && binding.taskId && activeTaskId !== binding.taskId) {
    return finalize(
      SPEC_STATES.SUPERSEDED,
      SPEC_STRATEGIES.CANCEL,
      'task substituída: a missão aponta para outra EngineeringTask',
      { taskStatus, activeTaskId, taskId: binding.taskId },
    );
  }

  if (!currentSpec || currentSpec.version === undefined || currentSpec.version === null) {
    return finalize(
      SPEC_STATES.UNBOUND,
      SPEC_STRATEGIES.RECONCILE,
      'versão corrente da MissionSpec indisponível — frescor não verificável',
      { taskStatus, binding, currentSpec: null },
    );
  }

  const sameVersion = Number(binding.missionVersion) === Number(currentSpec.version);
  const sameHash = Boolean(binding.specHash) && binding.specHash === currentSpec.specHash;

  if (sameVersion && sameHash) {
    return finalize(
      SPEC_STATES.CURRENT,
      SPEC_STRATEGIES.PROCEED,
      `vínculo confere com a versão corrente (v${currentSpec.version})`,
      { taskStatus, missionVersion: currentSpec.version, specHash: currentSpec.specHash },
    );
  }

  // Mesma versão, hash diferente: a spec da MESMA versão foi alterada. Isso é anomalia (viola
  // imutabilidade de versão) — a task executa contrato que não corresponde mais ao aprovado.
  if (sameVersion && !sameHash) {
    return finalize(
      SPEC_STATES.STALE,
      material ? SPEC_STRATEGIES.RECONCILE : SPEC_STRATEGIES.CANCEL,
      `hash da MissionSpec v${currentSpec.version} diverge do hash vinculado à task (versão mutada após o vínculo)`,
      { taskStatus, missionVersion: currentSpec.version, bindingHash: binding.specHash || null, currentHash: currentSpec.specHash || null },
    );
  }

  // Versão vinculada é ANTERIOR à corrente: existe versão superadora.
  const ahead = Number(binding.missionVersion) < Number(currentSpec.version);
  if (ahead) {
    return finalize(
      SPEC_STATES.SUPERSEDED,
      material ? SPEC_STRATEGIES.RECONCILE : SPEC_STRATEGIES.SUPERSEDE,
      `task vinculada à v${binding.missionVersion} mas a versão corrente é v${currentSpec.version}`,
      { taskStatus, bindingVersion: binding.missionVersion, currentVersion: currentSpec.version },
    );
  }

  // Versão vinculada é POSTERIOR à corrente (rollback de spec): reconciliação humana.
  return finalize(
    SPEC_STATES.STALE,
    SPEC_STRATEGIES.RECONCILE,
    `task vinculada à v${binding.missionVersion}, posterior à versão corrente v${currentSpec.version}`,
    { taskStatus, bindingVersion: binding.missionVersion, currentVersion: currentSpec.version },
  );
}

/** A fase material pode rodar? Regra única consumida pelos guards. */
function canRunMaterialPhase(assessment) {
  return assessment?.strategy === SPEC_STRATEGIES.PROCEED;
}

module.exports = {
  SPEC_STATES,
  SPEC_STRATEGIES,
  MATERIAL_PHASES,
  TERMINAL_PHASES,
  isMaterialPhase,
  isTerminalPhase,
  assessSpecFreshness,
  canRunMaterialPhase,
};
