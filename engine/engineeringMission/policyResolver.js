'use strict';

/**
 * engine/engineeringMission/policyResolver.js — POLICY RESOLVER formal (§20, §21).
 *
 * Achado real da auditoria V2: a política da missão era aplicada por MERGE:
 *
 *     const policy = { ...globalPolicy, ...(mission.auto_approval_policy || {}) };
 *
 * Isso deixa a missão AMPLIAR privilégio em silêncio. Exemplo concreto que passava:
 * global `maxRisk = MEDIUM` e a missão declarando `auto_approval_policy = { maxRisk: 'CRITICAL',
 * confidenceThreshold: 0.1 }` produzia uma política efetiva MAIS PERMISSIVA que a instalação — a
 * missão acabava autorizando a si mesma algo que o operador nunca autorizou.
 *
 * Regra aqui implementada:
 *   - missão pode ser MAIS RESTRITIVA que a global — sempre permitido;
 *   - missão NÃO pode ampliar privilégio, exceto com autorização administrativa explícita
 *     (`actor.canEscalatePolicy`) E permissão da própria política (`allowPolicyEscalation`);
 *   - nada é "clampado" em silêncio: a decisão é explícita (ALLOW / DENY), com as diferenças e as
 *     escalações registradas para virar EVIDÊNCIA persistida.
 *
 * Módulo PURO: não lê relógio, não lê banco, não chama rede. `evaluatedAt` é passado por quem
 * chama (a camada de serviço), mantendo o motor determinístico e testável.
 */

const { APPROVAL_MODES } = require('./constants');
const { DEFAULT_POLICY, RISK_RANK } = require('./autoApprovalPolicy');

const SCOPE_RANK = Object.freeze({ SMALL: 0, MEDIUM: 1, LARGE: 2 });

/** Ordem de amplitude dos modos: quanto maior, mais a política decide sozinha. */
const MODE_RANK = Object.freeze({ MANUAL: 0, SAFE_ONLY: 1, POLICY_BASED: 2 });

const DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  DENY: 'DENY',
});

const COMPARISONS = Object.freeze({
  NARROWER: 'NARROWER',
  EQUAL: 'EQUAL',
  WIDER: 'WIDER',
});

const AXIS_IDS = Object.freeze([
  'enabled',
  'mode',
  'maxRisk',
  'confidenceThreshold',
  'allowedMissionTypes',
  'allowedRepositories',
  'allowedBranches',
  'allowedScopes',
  'allowDerivedRequirements',
  'allowPolicyRequirements',
]);

/** Campos informativos: mudam relatório/rastreabilidade, não concedem amplitude. */
const INFORMATIONAL_AXES = Object.freeze(['policyId']);

function emptyListWidens() {
  return true; // convenção declarada em DEFAULT_POLICY: lista vazia = "qualquer" (o mais amplo)
}

function compareRisk(globalValue, requestedValue) {
  const g = RISK_RANK[globalValue] ?? RISK_RANK.MEDIUM;
  const r = RISK_RANK[requestedValue] ?? RISK_RANK.MEDIUM;
  if (r === g) return COMPARISONS.EQUAL;
  return r > g ? COMPARISONS.WIDER : COMPARISONS.NARROWER;
}

function compareScopeList(globalValue, requestedValue) {
  const g = Array.isArray(globalValue) ? globalValue : [];
  const r = Array.isArray(requestedValue) ? requestedValue : [];
  if (requestedValue === undefined) return COMPARISONS.EQUAL;
  if (r.length === 0 && g.length === 0) return COMPARISONS.EQUAL;
  if (r.length === 0) return emptyListWidens() ? COMPARISONS.WIDER : COMPARISONS.NARROWER;
  if (g.length === 0) return COMPARISONS.NARROWER; // global = qualquer; missão restringe
  const scopeRank = (list) => Math.max(...list.map((s) => SCOPE_RANK[s] ?? SCOPE_RANK.MEDIUM));
  const wider = r.some((item) => !g.includes(item));
  const losesRestriction = g.some((item) => !r.includes(item)) === false && scopeRank(r) > scopeRank(g);
  if (wider || losesRestriction) return COMPARISONS.WIDER;
  if (r.length < g.length || scopeRank(r) < scopeRank(g)) return COMPARISONS.NARROWER;
  return COMPARISONS.EQUAL;
}

function compareList(globalValue, requestedValue) {
  if (requestedValue === undefined) return COMPARISONS.EQUAL;
  const g = Array.isArray(globalValue) ? globalValue : [];
  const r = Array.isArray(requestedValue) ? requestedValue : [];
  if (r.length === 0 && g.length === 0) return COMPARISONS.EQUAL;
  if (r.length === 0) return emptyListWidens() ? COMPARISONS.WIDER : COMPARISONS.NARROWER;
  if (g.length === 0) return COMPARISONS.NARROWER;
  const added = r.filter((item) => !g.includes(item));
  const removed = g.filter((item) => !r.includes(item));
  if (added.length > 0 && removed.length === 0) return COMPARISONS.WIDER;
  if (added.length === 0 && removed.length === 0) return COMPARISONS.EQUAL;
  if (removed.length > 0 && added.length === 0) return COMPARISONS.NARROWER;
  // Misto: ganhou liberdade nova E perdeu restrição antiga ⇒ foi mais amplo em algum eixo.
  return COMPARISONS.WIDER;
}

function compareBoolean(globalValue, requestedValue) {
  if (requestedValue === undefined) return COMPARISONS.EQUAL;
  const g = globalValue === true;
  const r = requestedValue === true;
  if (g === r) return COMPARISONS.EQUAL;
  return r ? COMPARISONS.WIDER : COMPARISONS.NARROWER;
}

/** Threshold de confiança: MENOR é mais permissivo (aceita enriquecimento menos confiável). */
function compareThreshold(globalValue, requestedValue) {
  if (requestedValue === undefined) return COMPARISONS.EQUAL;
  const g = Number(globalValue);
  const r = Number(requestedValue);
  if (!Number.isFinite(g) || !Number.isFinite(r)) return COMPARISONS.WIDER; // valor inválido não afrouxa nada
  if (r === g) return COMPARISONS.EQUAL;
  return r < g ? COMPARISONS.WIDER : COMPARISONS.NARROWER;
}

function compareMode(globalValue, requestedValue) {
  if (requestedValue === undefined) return COMPARISONS.EQUAL;
  const g = MODE_RANK[globalValue] ?? MODE_RANK.MANUAL;
  const r = MODE_RANK[requestedValue] ?? MODE_RANK.MANUAL;
  if (r === g) return COMPARISONS.EQUAL;
  return r > g ? COMPARISONS.WIDER : COMPARISONS.NARROWER;
}

const AXIS_COMPARATORS = Object.freeze({
  enabled: compareBoolean,
  mode: compareMode,
  maxRisk: compareRisk,
  confidenceThreshold: compareThreshold,
  allowedMissionTypes: compareList,
  allowedRepositories: compareList,
  allowedBranches: compareList,
  allowedScopes: compareScopeList,
  allowDerivedRequirements: compareBoolean,
  allowPolicyRequirements: compareBoolean,
});

/** Diff por eixo: o que a missão pediu, o que a instalação permite e em que direção andou. */
function computeDifferences(globalPolicy, requestedPolicy) {
  const differences = [];
  for (const axis of AXIS_IDS) {
    if (requestedPolicy?.[axis] === undefined) continue;
    const comparison = AXIS_COMPARATORS[axis](globalPolicy?.[axis], requestedPolicy[axis]);
    if (comparison === COMPARISONS.EQUAL) continue;
    differences.push({
      axis,
      global: globalPolicy?.[axis] === undefined ? null : globalPolicy[axis],
      requested: requestedPolicy[axis],
      comparison,
    });
  }
  for (const axis of INFORMATIONAL_AXES) {
    if (requestedPolicy?.[axis] !== undefined && requestedPolicy[axis] !== globalPolicy?.[axis]) {
      differences.push({ axis, global: globalPolicy?.[axis] ?? null, requested: requestedPolicy[axis], comparison: 'INFORMATIONAL' });
    }
  }
  return differences;
}

/**
 * Política RECOMENDADA = o mais restritivo dos dois lados por eixo conhecido. Serve para
 * relatório/UI e para um modo explícito de clamp; NUNCA é aplicada em silêncio (a decisão é
 * sempre exposta em `decision`).
 */
function computeRestrictivePolicy(globalPolicy, requestedPolicy) {
  const restrictive = { ...globalPolicy };
  for (const axis of AXIS_IDS) {
    if (requestedPolicy?.[axis] === undefined) continue;
    const comparison = AXIS_COMPARATORS[axis](globalPolicy?.[axis], requestedPolicy[axis]);
    if (comparison === COMPARISONS.NARROWER || comparison === COMPARISONS.EQUAL) {
      restrictive[axis] = requestedPolicy[axis];
    }
  }
  return restrictive;
}

/**
 * Resolve a política efetiva de uma missão.
 *
 * @param {Object} params
 * @param {Object} [params.globalPolicy]     política da INSTALAÇÃO (autoridade)
 * @param {Object} [params.requestedPolicy]  override declarado pela missão
 * @param {Object} [params.actor]            `{ id, canEscalatePolicy }` — autorização explícita
 * @param {string} [params.evaluatedAt]      ISO — passado por quem chama (motor puro)
 * @returns {{
 *   policyId:string, globalPolicy:Object, requestedPolicy:Object, effectivePolicy:Object,
 *   restrictivePolicy:Object, differences:Array, escalations:Array,
 *   decision:string, reason:string, escalationAuthorized:boolean, evaluatedAt:string|null
 * }}
 */
function resolveMissionPolicy({ globalPolicy = DEFAULT_POLICY, requestedPolicy = null, actor = null, evaluatedAt = null } = {}) {
  const base = { ...DEFAULT_POLICY, ...(globalPolicy || {}) };
  const requested = requestedPolicy && typeof requestedPolicy === 'object' ? requestedPolicy : {};

  const differences = computeDifferences(base, requested);
  const escalations = differences.filter((d) => d.comparison === COMPARISONS.WIDER);
  const restrictivePolicy = computeRestrictivePolicy(base, requested);
  const actorCanEscalate = actor?.canEscalatePolicy === true;
  const policyAllowsEscalation = base.allowPolicyEscalation === true;
  const escalationAuthorized = escalations.length > 0 && actorCanEscalate && policyAllowsEscalation;

  let decision = DECISIONS.ALLOW;
  let reason;
  if (escalations.length === 0) {
    reason = differences.length === 0
      ? 'política da missão idêntica à da instalação'
      : 'política da missão apenas RESTRINGE a política da instalação';
  } else if (escalationAuthorized) {
    reason = `escalação autorizada por identidade administrativa explícita (${escalations.map((e) => e.axis).join(', ')})`;
  } else {
    decision = DECISIONS.DENY;
    reason = actorCanEscalate
      ? `escalação bloqueada: a política da instalação não permite escalação (eixos: ${escalations.map((e) => e.axis).join(', ')})`
      : `escalação bloqueada: a missão tentou ampliar privilégio sem autorização administrativa (eixos: ${escalations.map((e) => e.axis).join(', ')})`;
  }

  // Efetiva: quando a escalação é NEGADA, a política aplicada é a da INSTALAÇÃO — nunca a
  // solicitada. Não existe caminho em que uma requisição negada produza privilégio maior.
  const effectivePolicy = decision === DECISIONS.ALLOW ? { ...restrictivePolicy, ...(escalationAuthorized ? requested : {}) } : { ...base };

  return {
    policyId: requested.policyId || base.policyId,
    globalPolicy: base,
    requestedPolicy: requested,
    effectivePolicy,
    restrictivePolicy,
    differences,
    escalations,
    decision,
    reason,
    escalationAuthorized,
    evaluatedAt,
  };
}

module.exports = {
  DECISIONS,
  COMPARISONS,
  AXIS_IDS,
  INFORMATIONAL_AXES,
  MODE_RANK,
  SCOPE_RANK,
  computeDifferences,
  computeRestrictivePolicy,
  resolveMissionPolicy,
  APPROVAL_MODES,
};
