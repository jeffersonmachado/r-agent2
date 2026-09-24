'use strict';

/**
 * engine/engineeringMission/materiality.js — materialidade de uma alteração de MissionSpec.
 *
 * Classifica (§15):
 *   NON_MATERIAL — detalhes técnicos, testes adicionais, metadata, evidência, observabilidade.
 *   MATERIAL     — aumento de escopo, novo subsistema, novo acceptance criterion, mudança
 *                  arquitetural, escalada de risco.
 *   CRITICAL     — irreversível, segurança, RBAC, tenant isolation, produção destrutiva ou
 *                  tentativa de alterar o objetivo original.
 *
 * Uma alteração CRITICAL exige aprovação humana mesmo com autoaprovação habilitada.
 *
 * Módulo puro (sem I/O).
 */

const { MATERIALITY_RANK } = require('./constants');
const { RISK_RANK, ENRICHABLE_FIELDS } = require('./missionSpec');

/** Campos cujo simples acréscimo nunca aumenta escopo de execução. */
const NON_MATERIAL_FIELDS = Object.freeze(new Set([
  'testStrategy',
  'assumptions',
  'contextSources',
  'confidence',
  'enrichmentPolicyVersion',
]));

/** Regras de enriquecimento cuja introdução é crítica por definição. */
const CRITICAL_RULE_IDS = Object.freeze([
  'TENANT_ISOLATION',
  'SECRET_HYGIENE',
  'RBAC_AND_CLASSIFICATION',
  'DESTRUCTIVE_OPERATION_GUARD',
  'PRODUCTION_DESTRUCTIVE_OPERATION',
  'INCOMPATIBLE_SCHEMA_SAFETY',
]);

/** Campos cuja mudança é material quando efetivamente alterada. */
const MATERIAL_FIELDS = Object.freeze(new Set([
  'missionType',
  'objective',
  'acceptanceCriteria',
  'derivedRequirements',
  'constraints',
  'subsystems',
  'scope',
  'branch',
  'allowedPaths',
  'forbiddenPaths',
  'risk',
  'releaseBlocker',
  'explicitPolicyAuthorization',
]));

function requirementIds(list) {
  return new Set((Array.isArray(list) ? list : [])
    .map((r) => (typeof r === 'string' ? r : r && r.id))
    .filter(Boolean));
}

function textSet(list) {
  return new Set((Array.isArray(list) ? list : [])
    .map((r) => (typeof r === 'string' ? r : r && r.text))
    .filter(Boolean));
}

/**
 * @param {Object} params
 * @param {Object|null} params.previousSpec
 * @param {Object} params.nextSpec
 * @param {Object} [params.enrichment]  — enriquecimento que originou `nextSpec`
 * @param {Array}  [params.changes]     — diff já calculado (opcional; recalculado se ausente)
 * @returns {{level:string, reasons:Array<{code:string, detail:string}>}}
 */
function classifyMateriality({ previousSpec = null, nextSpec, enrichment = {}, changes = null }) {
  const reasons = [];
  const bump = (level) => { reasons.push(level); };

  // 1. Intenção original é intocável — qualquer mudança aqui é CRITICAL por definição.
  if (previousSpec && previousSpec.originalMission !== nextSpec.originalMission) {
    return {
      level: 'CRITICAL',
      reasons: [{ code: 'ORIGINAL_MISSION_CHANGE', detail: 'a intenção original não pode ser alterada por enriquecimento' }],
    };
  }

  const effectiveChanges = Array.isArray(changes) ? changes : null;
  const changedFields = effectiveChanges
    ? effectiveChanges.map((c) => c.field)
    : ENRICHABLE_FIELDS.filter((f) => JSON.stringify(previousSpec?.[f] ?? null) !== JSON.stringify(nextSpec?.[f] ?? null));

  // 2. Primeira versão (enriquecimento inicial) nunca é "alteração de versão aprovada".
  if (!previousSpec) {
    return {
      level: 'MATERIAL',
      reasons: [{ code: 'INITIAL_ENRICHMENT', detail: 'enriquecimento inicial da missão (nenhuma versão anterior aprovada)' }],
    };
  }

  // 3. CRITICAL: regra crítica nova, escalada para CRITICAL ou remoção de critério de aceite.
  const newRules = (Array.isArray(enrichment.derivedRequirements) ? enrichment.derivedRequirements : [])
    .filter((r) => r.ruleId && CRITICAL_RULE_IDS.includes(r.ruleId));
  const previousRuleIds = requirementIds(previousSpec.derivedRequirements);
  const introducedCritical = newRules.filter((r) => !previousRuleIds.has(r.id));
  if (introducedCritical.length > 0) {
    return {
      level: 'CRITICAL',
      reasons: introducedCritical.map((r) => ({ code: 'CRITICAL_REQUIREMENT_INTRODUCED', detail: `regra crítica "${r.ruleId}" introduzida: ${r.text}` })),
    };
  }

  const prevRisk = RISK_RANK[previousSpec.risk] ?? -1;
  const nextRisk = RISK_RANK[nextSpec.risk] ?? -1;
  if (nextRisk > prevRisk && nextRisk === RISK_RANK.CRITICAL) {
    return {
      level: 'CRITICAL',
      reasons: [{ code: 'RISK_ESCALATED_TO_CRITICAL', detail: `risco passou de ${previousSpec.risk} para ${nextSpec.risk}` }],
    };
  }

  const prevCriteria = textSet(previousSpec.acceptanceCriteria);
  const nextCriteria = textSet(nextSpec.acceptanceCriteria);
  const removed = [...prevCriteria].filter((t) => !nextCriteria.has(t));
  if (removed.length > 0) {
    return {
      level: 'CRITICAL',
      reasons: removed.map((t) => ({ code: 'ACCEPTANCE_CRITERION_REMOVED', detail: `critério de aceite removido: ${t}` })),
    };
  }

  // 4. MATERIAL.
  for (const field of changedFields) {
    if (field === 'originalMission') continue;
    if (NON_MATERIAL_FIELDS.has(field)) continue;
    if (!MATERIAL_FIELDS.has(field)) continue;
    if (field === 'risk') {
      if (nextRisk > prevRisk) bump('MATERIAL');
      continue;
    }
    bump('MATERIAL');
  }

  const prevSubsystems = new Set(previousSpec.subsystems || []);
  const addedSubsystems = (nextSpec.subsystems || []).filter((s) => !prevSubsystems.has(s));
  if (addedSubsystems.length > 0) bump('MATERIAL');

  const prevRequirements = requirementIds(previousSpec.derivedRequirements);
  const addedRequirements = (nextSpec.derivedRequirements || []).filter((r) => r && r.id && !prevRequirements.has(r.id));
  if (addedRequirements.length > 0) bump('MATERIAL');

  const level = reasons.includes('MATERIAL') || reasons.includes('CRITICAL')
    ? (reasons.includes('CRITICAL') ? 'CRITICAL' : 'MATERIAL')
    : 'NON_MATERIAL';

  return {
    level,
    reasons: reasons.length > 0
      ? reasons.map((l) => ({ code: l === 'MATERIAL' ? 'MATERIAL_FIELD_CHANGE' : 'NON_MATERIAL', detail: `alteração classificada como ${l}` }))
      : [{ code: 'NON_MATERIAL', detail: 'nenhuma alteração material detectada' }],
  };
}

function maxMateriality(a, b) {
  return (MATERIALITY_RANK[a] ?? 0) >= (MATERIALITY_RANK[b] ?? 0) ? a : b;
}

module.exports = {
  NON_MATERIAL_FIELDS,
  MATERIAL_FIELDS,
  CRITICAL_RULE_IDS,
  classifyMateriality,
  maxMateriality,
};
