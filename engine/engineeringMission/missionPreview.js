'use strict';

/**
 * engine/engineeringMission/missionPreview.js — preview de enriquecimento (§7).
 *
 * Antes de qualquer execução, o usuário precisa ver EXATAMENTE o que foi acrescentado, de onde
 * veio e por quê — inclusive quando a missão foi autoaprovada (autoaprovação não pode virar
 * execução invisível).
 *
 * Cada item do preview carrega provenance objetiva: campo, valor original, valor enriquecido,
 * tipo (ADDED/MODIFIED/INFERRED/POLICY_REQUIRED/UNCHANGED), motivo, fonte, confiança e impacto de
 * risco. NUNCA raciocínio interno de modelo.
 *
 * Módulo puro (sem I/O).
 */

const { ENRICHMENT_TYPES } = require('./constants');

const CATEGORY_LABELS = Object.freeze({
  ADDED: 'Adicionado',
  MODIFIED: 'Modificado',
  INFERRED: 'Inferido do contexto',
  POLICY_REQUIRED: 'Obrigatório por política',
  UNCHANGED: 'Sem alteração',
});

/** Campos do spec que, permanecendo iguais à intenção original, aparecem como UNCHANGED. */
const UNCHANGED_CANDIDATES = Object.freeze(['objective', 'constraints', 'scope', 'branch', 'allowedPaths', 'forbiddenPaths']);

function categoryOf(provenanceEntry) {
  const type = provenanceEntry.enrichmentType;
  if (ENRICHMENT_TYPES.includes(type)) return type;
  return 'INFERRED';
}

/**
 * @param {Object} params
 * @param {Object} params.spec            — MissionSpec da versão corrente
 * @param {Object} params.enrichment      — saída do enrichmentBuilder
 * @param {Object} [params.previousSpec]  — versão anterior (para diff visual de re-enriquecimento)
 * @param {Array}  [params.changes]       — diff de specs
 * @param {Object} [params.materiality]   — { level, reasons }
 * @param {Object} [params.autoApproval]  — saída do autoApprovalPolicy
 */
function buildEnrichmentPreview({ spec, enrichment, previousSpec = null, changes = [], materiality = null, autoApproval = null }) {
  const provenance = Array.isArray(enrichment.provenance) ? enrichment.provenance : [];

  const sectionsMap = new Map(ENRICHMENT_TYPES.map((t) => [t, []]));
  for (const entry of provenance) {
    sectionsMap.get(categoryOf(entry)).push({
      field: entry.field,
      originalValue: entry.originalValue ?? null,
      enrichedValue: entry.enrichedValue ?? null,
      enrichmentType: categoryOf(entry),
      reason: entry.reason || null,
      source: entry.source || null,
      confidence: entry.confidence === undefined ? null : entry.confidence,
      riskImpact: entry.riskImpact || null,
      ruleId: entry.ruleId || null,
    });
  }

  const unchanged = [];
  for (const field of UNCHANGED_CANDIDATES) {
    const value = spec?.[field];
    const isDefaultOrEmpty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    if (isDefaultOrEmpty) {
      unchanged.push({ field, value: field === 'objective' ? spec?.originalMission : null });
      continue;
    }
    const changedByProvenance = provenance.some((p) => p.field === field);
    if (!changedByProvenance) unchanged.push({ field, value });
  }
  for (const item of unchanged) {
    sectionsMap.get('UNCHANGED').push({
      field: item.field,
      originalValue: item.value,
      enrichedValue: item.value,
      enrichmentType: 'UNCHANGED',
      reason: 'mantido exatamente como definido na intenção original',
      source: 'USER_INPUT',
      confidence: 1,
      riskImpact: 'LOW',
      ruleId: null,
    });
  }

  const sections = ENRICHMENT_TYPES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    items: sectionsMap.get(category),
  }));

  return {
    missionId: spec?.missionId || null,
    version: spec?.version || null,
    specHash: spec?.specHash || null,
    original: { mission: spec?.originalMission || null },
    enriched: {
      missionType: spec?.missionType || null,
      missionTypeInferred: enrichment.missionTypeInferred === true,
      objective: spec?.objective || null,
      risk: spec?.risk || null,
      confidence: spec?.confidence === null || spec?.confidence === undefined ? null : spec.confidence,
      subsystems: spec?.subsystems || [],
      acceptanceCriteria: spec?.acceptanceCriteria || [],
      testStrategy: spec?.testStrategy || [],
      constraints: spec?.constraints || [],
      assumptions: spec?.assumptions || [],
      contextSources: spec?.contextSources || [],
    },
    sections,
    counts: Object.fromEntries(ENRICHMENT_TYPES.map((t) => [
      t,
      sectionsMap.get(t).length,
    ])),
    specDiff: (changes || []).map((c) => ({
      field: c.field,
      previousValue: c.previousValue ?? null,
      nextValue: c.nextValue ?? null,
    })),
    reEnriched: previousSpec !== null,
    previousVersion: previousSpec ? previousSpec.version : null,
    materiality: materiality || null,
    autoApproval: autoApproval
      ? {
        eligible: autoApproval.eligible,
        mode: autoApproval.mode,
        policyId: autoApproval.policyId,
        blockers: autoApproval.blockers,
        rulesEvaluated: autoApproval.rulesEvaluated,
      }
      : null,
  };
}

/**
 * Resumo textual determinístico (usado por CLI e por relatórios de auditoria externa — §39).
 */
function summarizePreview(preview) {
  const lines = [];
  lines.push(`Missão original: ${preview.original.mission}`);
  lines.push(`Tipo: ${preview.enriched.missionType}${preview.enriched.missionTypeInferred ? ' (inferido)' : ''}`);
  lines.push(`Risco: ${preview.enriched.risk} | Confiança: ${preview.enriched.confidence}`);
  lines.push(`Objetivo: ${preview.enriched.objective}`);
  for (const section of preview.sections) {
    if (section.category === 'UNCHANGED' || section.items.length === 0) continue;
    lines.push(`${section.label}:`);
    for (const item of section.items) lines.push(`  - ${item.enrichedValue} [${item.source}]`);
  }
  if (preview.autoApproval) {
    lines.push(`Autoaprovação: ${preview.autoApproval.eligible ? 'ELEGÍVEL' : 'BLOQUEADA'} (modo ${preview.autoApproval.mode}, política ${preview.autoApproval.policyId})`);
    for (const b of preview.autoApproval.blockers) lines.push(`  bloqueio: ${b.code} — ${b.detail}`);
  }
  return lines.join('\n');
}

module.exports = {
  CATEGORY_LABELS,
  UNCHANGED_CANDIDATES,
  buildEnrichmentPreview,
  summarizePreview,
};
