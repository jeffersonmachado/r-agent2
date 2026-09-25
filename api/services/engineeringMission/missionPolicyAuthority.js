'use strict';

/**
 * api/services/engineeringMission/missionPolicyAuthority.js
 *
 * AUTORIDADE ÚNICA de resolução da política de autoaprovação de uma missão.
 *
 * Achado real da auditoria V2 (medido em 2026-09-25): a política era resolvida de TRÊS formas
 * diferentes, uma por caminho de chamada:
 *
 *   1. `missionCompilerService.enrichMission`  → `resolveMissionPolicy` (resolver formal)
 *   2. `missionApprovalService.evaluatePolicyForMission` (UI/pré-aprovação)
 *                                              → `{ ...policy, ...mission.auto_approval_policy }`
 *                                                (merge ingênuo: a missão ampliava privilégio)
 *   3. `missionApprovalService.editAndApprove` → `policy` global puro
 *                                                (ignorava a política declarada pela missão)
 *
 * Consequência medida: a UI declarava ELEGÍVEL o que a execução real recusava com
 * `POLICY_ESCALATION_DENIED` — preview e execução discordavam, e a decisão do caminho 3 era
 * tomada sob uma política diferente da que o preview exibiu ao operador.
 *
 * Este módulo é a ÚNICA forma de resolver a política. Preview, edição, re-enriquecimento,
 * aprovação, execução, API e recuperação consomem daqui, de modo que
 * `decisão(preview) === decisão(execução)` por construção, não por coincidência.
 *
 * Módulo de SERVIÇO (pode ler o store). O motor (`engine/engineeringMission/policyResolver`)
 * continua PURO e é quem decide; aqui só se monta a entrada e se aplica a consequência.
 */

const { resolveMissionPolicy, DECISIONS } = require('../../../engine/engineeringMission/policyResolver');
const { evaluateAutoApproval } = require('../../../engine/engineeringMission/autoApprovalPolicy');
const missionStore = require('./missionStoreService');

const POLICY_FAILURE_CODES = Object.freeze({
  ESCALATION_DENIED: 'POLICY_ESCALATION_DENIED',
});

/**
 * Resolve a política efetiva de uma missão + avalia elegibilidade.
 *
 * A autorização de escalação NUNCA é derivada do corpo da requisição: `policyEscalationAuthorized`
 * é um booleano que a borda (RBAC) ou um worker confiável afirma ter verificado.
 *
 * @param {Object} params
 * @param {string} [params.missionId]
 * @param {Object} [params.mission]                  evita releitura quando o chamador já tem a missão
 * @param {string} [params.actor]
 * @param {boolean} [params.policyEscalationAuthorized=false]
 * @param {string} [params.evaluatedAt]              ISO — injetado (determinismo/teste)
 * @returns {Promise<Object>} resolução + `{ denied, evaluate }`
 */
async function resolvePolicyForMission({
  missionId = null,
  mission = null,
  actor = null,
  policyEscalationAuthorized = false,
  evaluatedAt = null,
} = {}) {
  const resolvedMission = mission || (missionId ? await missionStore.getMission(missionId) : null);
  const globalPolicy = await missionStore.getAutoApprovalPolicy();

  const resolution = resolveMissionPolicy({
    globalPolicy,
    requestedPolicy: resolvedMission?.auto_approval_policy || null,
    actor: { id: actor || null, canEscalatePolicy: policyEscalationAuthorized === true },
    evaluatedAt: evaluatedAt || new Date().toISOString(),
  });

  return {
    ...resolution,
    denied: resolution.decision === DECISIONS.DENY,
    /**
     * Avaliação de elegibilidade SEMPRE sobre a política EFETIVA — a mesma que a execução usa.
     * É isso que faz preview e execução concordarem.
     */
    evaluate: ({ spec = {}, enrichment = {}, repository = null, branch = null } = {}) => evaluateAutoApproval({
      policy: resolution.effectivePolicy,
      spec,
      enrichment,
      repository: repository || spec.repository || null,
      branch: branch || spec.branch || null,
    }),
  };
}

/**
 * Aplica a consequência da resolução: escalação negada é RECUSA EXPLÍCITA, nunca clamp silencioso.
 * @returns {Object} `effectivePolicy` quando autorizado
 */
function requireAuthorizedPolicy(resolution, missionId = null) {
  if (!resolution || resolution.denied !== true) return resolution ? resolution.effectivePolicy : null;
  const err = new Error(resolution.reason);
  err.code = POLICY_FAILURE_CODES.ESCALATION_DENIED;
  err.missionId = missionId;
  err.escalations = resolution.escalations;
  err.resolution = resolution;
  throw err;
}

/** Blocker de política pronto para a superfície de preview/UI (mesmo código da recusa real). */
function policyDenialBlocker(resolution) {
  if (!resolution || resolution.denied !== true) return null;
  return {
    code: POLICY_FAILURE_CODES.ESCALATION_DENIED,
    detail: resolution.reason,
    escalations: resolution.escalations.map((e) => ({ axis: e.axis, global: e.global, requested: e.requested })),
  };
}

module.exports = {
  POLICY_FAILURE_CODES,
  resolvePolicyForMission,
  requireAuthorizedPolicy,
  policyDenialBlocker,
};
