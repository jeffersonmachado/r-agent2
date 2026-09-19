'use strict';

/**
 * Benchmark Finding Extraction — transforma o resultado da INSPEÇÃO de uma
 * fonte em achados ESTRUTURADOS e auditáveis (TAREFA 09/10/12/18, revisado pela
 * missão semântica de 2026-09-15).
 *
 * Regra dura desta camada: ela NÃO decide o que existe no produto do
 * concorrente. Ela só aceita o que o provider de inspeção (`research.
 * inspectDocumentation` / `research.inspectApiDocs`) devolveu COM locator na
 * fonte. Na ausência de provider, o resultado é vazio — nunca inferido de
 * conhecimento do modelo (é isso que separa pesquisa de alegação).
 *
 * PIPELINE SEMÂNTICO (2026-09-15): itens brutos da inspeção NÃO são mais
 * promovidos a achados por palavra-chave. Eles entram como OBSERVAÇÕES no
 * funil `semantic/normalizationPipeline`:
 *
 *   observação bruta → classificação semântica (slogan/FAQ/preço/nav/ruído
 *   rejeitados nominalmente) → candidato tipado (verbo + objeto + desfecho)
 *   → dedup → cluster de equivalência (anti-over-merge) → normalização
 *   longest-match → canônico ou novidade candidata.
 *
 * O que resiste à estruturação volta em `unresolved` (persistido para
 * auditoria, excluído da novidade canônica pelo serviço).
 *
 * Cada achado carrega:
 *   benchmarkId, sourceRef, kind, externalName, description, locator,
 *   fragmentHash, contentHash (do documento ANALISADO), origin, normalizedId,
 *   canonicalId (quando o nome casa com equivalência declarada), confidence,
 *   semanticStatus, form, structuredRule, clusterId, normalizationRationale.
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
const { runNormalizationPipeline, mergePipelineMetrics, SEMANTIC_STATUS } = require('./semantic/normalizationPipeline');
const { buildSemanticVersionRecord } = require('./semantic/semanticPipelineVersion');

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
 * Converte os itens brutos de UM eixo da inspeção em observações do funil.
 * Itens sem nome são recusa estrutural (`finding_without_name`) — o funil só
 * vê observações com texto.
 */
function axisObservations({ inspection, axis }) {
  const field = AXIS_TO_INSPECTION_FIELD[axis];
  if (!field) return { observations: [], rejected: [], extracted: 0 };
  const rawItems = toArray(inspection?.[field]);
  const observations = [];
  const rejected = [];
  for (const raw of rawItems) {
    const text = isNonEmptyString(raw?.name) ? raw.name.trim() : null;
    if (!text) {
      rejected.push({ reason: 'finding_without_name', locator: isNonEmptyString(raw?.locator) ? raw.locator.trim() : null });
      continue;
    }
    observations.push({
      text,
      locator: isNonEmptyString(raw?.locator) ? raw.locator.trim() : null,
      fragmentHash: isNonEmptyString(raw?.fragmentHash) ? raw.fragmentHash.trim() : null,
      description: isNonEmptyString(raw?.description) ? raw.description.trim() : null,
      classification: isNonEmptyString(raw?.classification) ? String(raw.classification).toUpperCase() : null,
      axis,
    });
  }
  return { observations, rejected, extracted: rawItems.length };
}

/**
 * Extrai os três eixos de uma vez PELO FUNIL SEMÂNTICO, a partir do que a
 * inspeção entregou. A ordem dos eixos é fixa para que a curva de novidade
 * seja reproduzível.
 *
 * @returns {{findings: Array, unresolved: Array, rejected: Array, perAxis: object, semanticMetrics: object}}
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
  const axes = [RESEARCH_AXES.CAPABILITY, RESEARCH_AXES.JOURNEY, RESEARCH_AXES.BUSINESS_RULE];

  const observations = [];
  const rejected = [];
  const extractedByAxis = {};
  for (const axis of axes) {
    const result = axisObservations({ inspection, axis });
    extractedByAxis[axis] = result.extracted;
    observations.push(...result.observations);
    rejected.push(...result.rejected);
  }

  const pipeline = runNormalizationPipeline({
    observations,
    contentHash,
    source: { url: sourceUrl || null, tier: sourceTier },
    benchmark,
  });
  rejected.push(...pipeline.rejected);

  // Versão do pipeline que PRODUZIU estes achados. Sem ela, um achado antigo
  // continua certificando a vertical depois de a regra mudar — o significado
  // dele foi reescrito em silêncio. Derivada do conteúdo dos módulos, nunca de
  // timestamp (ver semantic/semanticPipelineVersion.js).
  const semanticLineage = buildSemanticVersionRecord();

  const findings = pipeline.candidates.map((candidate) => ({
    vertical,
    benchmarkId,
    kind: candidate.kind,
    axis: axisForKind(candidate.kind),
    externalName: candidate.externalName,
    description: candidate.description,
    locator: candidate.locator,
    fragmentHash: candidate.fragmentHash,
    contentHash: contentHash || null,
    sourceUrl: sourceUrl || null,
    sourceTier,
    // §TAREFA 23 — identidade normalizada do achado (nunca o nome do fornecedor).
    normalizedId: candidate.normalizedId,
    // Missão semântica 2026-09-15 — equivalência DECLARADA pela política é
    // CONFIRMAÇÃO (canonical_id preenchido), não novidade: o serviço exclui
    // achados mapeados da curva de novidade. Só o estruturado NÃO mapeado
    // permanece como novidade candidata.
    canonicalId: candidate.canonicalId || null,
    confidence: candidate.confidence,
    classification: candidate.classification || null,
    origin: candidate.origin,
    semanticStatus: candidate.semanticStatus,
    form: candidate.form || null,
    structuredRule: candidate.structuredRule || null,
    clusterId: candidate.clusterId,
    normalizationRationale: candidate.normalizationRationale,
    ...semanticLineage,
  }));

  const unresolved = pipeline.unresolved.map((candidate) => ({
    vertical,
    benchmarkId,
    kind: candidate.kind,
    axis: axisForKind(candidate.kind),
    externalName: candidate.externalName,
    description: candidate.description,
    locator: candidate.locator,
    fragmentHash: candidate.fragmentHash,
    contentHash: contentHash || null,
    sourceUrl: sourceUrl || null,
    sourceTier,
    normalizedId: null,
    canonicalId: null,
    confidence: candidate.confidence,
    classification: candidate.classification || null,
    origin: candidate.origin,
    semanticStatus: candidate.semanticStatus,
    form: candidate.form || null,
    structuredRule: null,
    clusterId: null,
    normalizationRationale: candidate.normalizationRationale,
    ...semanticLineage,
  }));

  const perAxis = {};
  for (const axis of axes) {
    const kind = kindForAxis(axis);
    const accepted = findings.filter((finding) => finding.kind === kind).length;
    perAxis[axis] = {
      extracted: extractedByAxis[axis] || 0,
      accepted,
      rejected: (extractedByAxis[axis] || 0) - accepted,
    };
  }

  return {
    findings,
    unresolved,
    rejected,
    perAxis,
    semanticMetrics: pipeline.metrics,
    semanticStatus: SEMANTIC_STATUS,
    axisForKind,
    inspectionKind,
  };
}

module.exports = {
  AXIS_TO_INSPECTION_FIELD,
  axisObservations,
  extractInspectionFindings,
  // Reexportados para consumidores que montavam a extração peça a peça.
  isSubjectNameFinding,
  normalizeFindingName,
  resolveFindingOrigin,
  FINDING_ORIGINS,
  SEMANTIC_CODES,
  mergePipelineMetrics,
};
