'use strict';

/**
 * Benchmark Finding Extraction — transforma o resultado da INSPEÇÃO de uma
 * fonte em achados ESTRUTURADOS e auditáveis (TAREFA 09/10/12/18).
 *
 * Regra dura desta camada: ela NÃO decide o que existe no produto do
 * concorrente. Ela só aceita o que o provider de inspeção (`research.
 * inspectDocumentation` / `research.inspectApiDocs`) devolveu COM locator na
 * fonte. Na ausência de provider, o resultado é vazio — nunca inferido de
 * conhecimento do modelo (é isso que separa pesquisa de alegação).
 *
 * Cada achado carrega:
 *   benchmarkId, sourceRef, kind, externalName, description, locator,
 *   fragmentHash, contentHash (do documento ANALISADO), origin, normalizedId,
 *   canonicalId (quando o nome casa com equivalência declarada), confidence.
 *
 * Achados sem locator são marcados `RAP_DERIVED` e NÃO entram na novidade —
 * inferência interna não é observação do fornecedor.
 */

const {
  RESEARCH_AXES,
  FINDING_ORIGINS,
  SEMANTIC_CODES,
  axisForKind,
  kindForAxis,
  isSubjectNameFinding,
  normalizeFindingName,
  resolveFindingOrigin,
} = require('./benchmarkResearchSemantics');

const AXIS_TO_INSPECTION_FIELD = Object.freeze({
  [RESEARCH_AXES.CAPABILITY]: 'capabilities',
  [RESEARCH_AXES.JOURNEY]: 'journeys',
  [RESEARCH_AXES.BUSINESS_RULE]: 'rules',
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Extrai os achados de UMA inspeção para UM eixo.
 *
 * @param {object} args
 * @param {object} args.inspection  saída do provider de inspeção
 * @param {string} args.axis        RESEARCH_AXES.*
 * @param {string} args.vertical
 * @param {string} args.benchmarkId
 * @param {object} args.benchmark   `{ id, name, aliases }` — o SUJEITO
 * @param {string} args.contentHash hash do documento efetivamente analisado
 * @param {string} args.sourceUrl
 * @param {number|null} [args.sourceTier]
 * @returns {{findings: Array, rejected: Array, counts: object}}
 */
function extractAxisFindings({
  inspection,
  axis,
  vertical,
  benchmarkId,
  benchmark,
  contentHash,
  sourceUrl,
  sourceTier = null,
}) {
  const kind = kindForAxis(axis);
  const field = AXIS_TO_INSPECTION_FIELD[axis];
  if (!kind || !field) return { findings: [], rejected: [], counts: { extracted: 0, accepted: 0, rejected: 0 } };

  const rawItems = toArray(inspection?.[field]);
  const findings = [];
  const rejected = [];

  for (const raw of rawItems) {
    const externalName = isNonEmptyString(raw?.name) ? raw.name.trim() : null;
    const locator = isNonEmptyString(raw?.locator) ? raw.locator.trim() : null;

    if (!externalName) {
      rejected.push({ reason: 'finding_without_name', locator });
      continue;
    }
    // §TAREFA 02/03/78 — o fornecedor é o SUJEITO da pesquisa, não um achado.
    if (isSubjectNameFinding({ candidate: externalName, benchmark })) {
      rejected.push({ reason: SEMANTIC_CODES.SUBJECT_AS_CAPABILITY, externalName });
      continue;
    }

    const origin = resolveFindingOrigin({ locator, origin: raw?.origin });
    const normalized = normalizeFindingName({ externalName, kind });

    findings.push({
      vertical,
      benchmarkId,
      kind,
      axis,
      externalName,
      description: isNonEmptyString(raw?.description) ? raw.description.trim() : null,
      locator,
      fragmentHash: isNonEmptyString(raw?.fragmentHash) ? raw.fragmentHash.trim() : null,
      contentHash: contentHash || null,
      sourceUrl: sourceUrl || null,
      sourceTier,
      // §TAREFA 23 — identidade normalizada do achado (nunca o nome do fornecedor).
      normalizedId: normalized.canonicalId,
      canonicalId: null,
      confidence: origin === FINDING_ORIGINS.EXTERNAL_OBSERVED ? 'OBSERVED' : 'DERIVED',
      classification: isNonEmptyString(raw?.classification) ? String(raw.classification).toUpperCase() : null,
      origin,
    });
  }

  return {
    findings,
    rejected,
    counts: { extracted: rawItems.length, accepted: findings.length, rejected: rejected.length },
  };
}

/**
 * Extrai os três eixos de uma vez, a partir do que a inspeção entregou.
 * A ordem dos eixos é fixa para que a curva de novidade seja reproduzível.
 */
function extractInspectionFindings({
  inspection,
  inspectionKind = 'documentation',
  vertical,
  benchmarkId,
  benchmark,
  contentHash,
  sourceUrl,
  sourceTier = null,
}) {
  const axes = inspectionKind === 'api'
    ? [RESEARCH_AXES.CAPABILITY, RESEARCH_AXES.JOURNEY, RESEARCH_AXES.BUSINESS_RULE]
    : [RESEARCH_AXES.CAPABILITY, RESEARCH_AXES.JOURNEY, RESEARCH_AXES.BUSINESS_RULE];

  const findings = [];
  const rejected = [];
  const perAxis = {};

  for (const axis of axes) {
    const result = extractAxisFindings({
      inspection,
      axis,
      vertical,
      benchmarkId,
      benchmark,
      contentHash,
      sourceUrl,
      sourceTier,
    });
    perAxis[axis] = result.counts;
    findings.push(...result.findings);
    rejected.push(...result.rejected);
  }

  return { findings, rejected, perAxis, axisForKind };
}

module.exports = {
  AXIS_TO_INSPECTION_FIELD,
  extractAxisFindings,
  extractInspectionFindings,
};
