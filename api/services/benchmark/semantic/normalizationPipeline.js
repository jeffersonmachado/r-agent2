'use strict';

/**
 * Normalization Pipeline — orquestra o funil semântico completo da pesquisa de
 * benchmarks:
 *
 *   RAW OBSERVATION → SEMANTIC CLASSIFICATION → CANDIDATE FINDING → DEDUP
 *   → CLUSTER → NORMALIZATION (longest-match da política) → CANONICAL MAPPING
 *   → NOVELTY INPUT
 *
 * Só o que sai NORMALIZED deste funil pode virar achado persistido elegível a
 * novidade canônica. `UNRESOLVED_SEMANTIC_CANDIDATE` é devolvido à parte para
 * auditoria (persistido, mas EXCLUÍDO da novidade pelo serviço). Rejeições são
 * nominais e contadas — o funil nunca descarta silenciosamente.
 *
 * Todo candidato normalizado carrega: source (url/tier), contentHash do
 * documento analisado, fragment/locator, origin (EXTERNAL_OBSERVED exige
 * locator), confidence e normalizationRationale (qual termo declarado casou,
 * ou por que ficou sem canônico).
 *
 * Métricas emitidas por execução (somatório das etapas):
 *   rawObservations, marketingClaimsRejected, faqQuestionsRejected,
 *   noiseRejected, candidateCapabilities/Journeys/BusinessRules,
 *   normalizedCapabilities/Journeys/BusinessRules, unresolvedSemanticCandidates,
 *   duplicatesCollapsed, overMergeRejected, evidenceMissingRejected,
 *   hashMismatchRejected.
 */

const crypto = require('crypto');

const {
  SEMANTIC_CODES,
  FINDING_ORIGINS,
  isSubjectNameFinding,
  normalizeFindingName,
} = require('../benchmarkResearchSemantics');
const { OBSERVATION_TYPES, SIGNAL_TYPES, classifyObservation } = require('./observationClassifier');
const { SEMANTIC_STATUS, extractCandidate } = require('./semanticExtractor');
const { clusterCandidates } = require('./clustering');

const KIND_BY_SIGNAL = Object.freeze({
  [OBSERVATION_TYPES.CAPABILITY_SIGNAL]: 'capability',
  [OBSERVATION_TYPES.JOURNEY_SIGNAL]: 'journey',
  [OBSERVATION_TYPES.BUSINESS_RULE_SIGNAL]: 'businessRule',
});

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function emptyMetrics() {
  return {
    rawObservations: 0,
    marketingClaimsRejected: 0,
    faqQuestionsRejected: 0,
    noiseRejected: 0,
    headlinesRejected: 0,
    benefitStatementsRejected: 0,
    pricingTextRejected: 0,
    navigationRejected: 0,
    testimonialsRejected: 0,
    legalTextRejected: 0,
    subjectNameRejected: 0,
    candidateCapabilities: 0,
    candidateJourneys: 0,
    candidateBusinessRules: 0,
    normalizedCapabilities: 0,
    normalizedJourneys: 0,
    normalizedBusinessRules: 0,
    unresolvedSemanticCandidates: 0,
    duplicatesCollapsed: 0,
    overMergeRejected: 0,
    evidenceMissingRejected: 0,
    hashMismatchRejected: 0,
  };
}

const REJECTION_METRIC = Object.freeze({
  [OBSERVATION_TYPES.MARKETING_CLAIM]: 'marketingClaimsRejected',
  [OBSERVATION_TYPES.FAQ_QUESTION]: 'faqQuestionsRejected',
  [OBSERVATION_TYPES.NOISE]: 'noiseRejected',
  [OBSERVATION_TYPES.HEADLINE]: 'headlinesRejected',
  [OBSERVATION_TYPES.BENEFIT_STATEMENT]: 'benefitStatementsRejected',
  [OBSERVATION_TYPES.PRICING_TEXT]: 'pricingTextRejected',
  [OBSERVATION_TYPES.NAVIGATION]: 'navigationRejected',
  [OBSERVATION_TYPES.TESTIMONIAL]: 'testimonialsRejected',
  [OBSERVATION_TYPES.LEGAL_TEXT]: 'legalTextRejected',
});

/**
 * Binding de fragmento: quando o locator declara `fragmentHash` BEM FORMADO
 * (`sha256:<64 hex>`) e o texto NÃO está truncado, o hash é conferido.
 * Divergência = o texto não é o fragmento declarado — rejeitado por código.
 * Um hash malformado (placeholder de fixture) não é verificável: não prova
 * nada e não é fingido como divergência — a observação segue sem o binding.
 */
function fragmentHashVerifiable(text, fragmentHash) {
  if (!isNonEmptyString(fragmentHash)) return null;
  const declared = String(fragmentHash).trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(declared)) return null;
  if (!isNonEmptyString(text) || text.endsWith('…')) return null;
  return `sha256:${sha256Hex(text)}` === declared;
}

/**
 * Executa o funil sobre as observações brutas de UMA fonte inspecionada.
 *
 * @param {object} args
 * @param {Array}  args.observations  `[{ text, locator, fragmentHash, description, axis, classification }]`
 * @param {string} [args.contentHash] hash do documento ANALISADO (liga o candidato à evidência)
 * @param {object} [args.source]      `{ url, tier }` da fonte
 * @param {object} [args.benchmark]   sujeito (para recusa sujeito-como-achado)
 * @returns {{candidates: Array, unresolved: Array, rejected: Array, metrics: object}}
 */
function runNormalizationPipeline({
  observations = [],
  contentHash = null,
  source = null,
  benchmark = null,
} = {}) {
  const metrics = emptyMetrics();
  const rejected = [];
  const extracted = [];
  const unresolved = [];

  for (const observation of Array.isArray(observations) ? observations : []) {
    const text = String(observation?.text ?? '').trim();
    metrics.rawObservations += 1;

    // O fornecedor é o SUJEITO da pesquisa, nunca um sinal de capability — a
    // recusa precede a classificação para que o evento seja contado como
    // sujeito-como-achado (e não dissolvido em ruído).
    if (isSubjectNameFinding({ candidate: text, benchmark })) {
      metrics.subjectNameRejected += 1;
      rejected.push({ reason: SEMANTIC_CODES.SUBJECT_AS_CAPABILITY, externalName: text });
      continue;
    }

    const classified = classifyObservation({ ...observation, text });

    if (!SIGNAL_TYPES.includes(classified.type)) {
      const metricKey = REJECTION_METRIC[classified.type];
      if (metricKey) metrics[metricKey] += 1;
      rejected.push({ reason: `semantic_type_${String(classified.type).toLowerCase()}`, detail: classified.reason, externalName: text, locator: observation?.locator || null });
      continue;
    }

    // Binding de fragmento quando verificável.
    const fragmentCheck = fragmentHashVerifiable(text, observation?.fragmentHash);
    if (fragmentCheck === false) {
      metrics.hashMismatchRejected += 1;
      rejected.push({ reason: 'semantic_fragment_hash_mismatch', externalName: text, locator: observation?.locator || null });
      continue;
    }

    const kind = KIND_BY_SIGNAL[classified.type];
    if (kind === 'capability') metrics.candidateCapabilities += 1;
    if (kind === 'journey') metrics.candidateJourneys += 1;
    if (kind === 'businessRule') metrics.candidateBusinessRules += 1;

    const candidate = extractCandidate({ observation: { ...observation, text }, classified, kind });

    if (candidate.semanticStatus === SEMANTIC_STATUS.UNRESOLVED) {
      metrics.unresolvedSemanticCandidates += 1;
      unresolved.push({
        ...candidate,
        contentHash: contentHash || null,
        sourceUrl: source?.url || null,
        sourceTier: source?.tier ?? null,
        origin: isNonEmptyString(candidate.locator) ? FINDING_ORIGINS.EXTERNAL_OBSERVED : FINDING_ORIGINS.RAP_DERIVED,
        confidence: 'UNRESOLVED',
        normalizationRationale: candidate.unresolvedReason,
      });
      continue;
    }

    // EXTERNAL_OBSERVED exige locator (TAREFA 18): sinal sem locator é
    // inferência interna e não entra nem como candidato observado.
    if (!isNonEmptyString(candidate.locator)) {
      metrics.evidenceMissingRejected += 1;
      rejected.push({ reason: SEMANTIC_CODES.EVIDENCE_LOCATOR_MISSING, externalName: text });
      continue;
    }

    extracted.push({
      ...candidate,
      contentHash: contentHash || null,
      sourceUrl: source?.url || null,
      sourceTier: source?.tier ?? null,
      origin: FINDING_ORIGINS.EXTERNAL_OBSERVED,
    });
  }

  // DEDUP: mesma forma normalizada + mesmo kind dentro da fonte.
  const seenForms = new Map();
  const deduped = [];
  for (const candidate of extracted) {
    const key = `${candidate.kind}:${candidate.form || normalizeTerm(candidate.externalName)}`;
    if (seenForms.has(key)) {
      metrics.duplicatesCollapsed += 1;
      const kept = seenForms.get(key);
      kept.duplicates = (kept.duplicates || 0) + 1;
      kept.dedupedNames = [...(kept.dedupedNames || []), candidate.externalName];
      continue;
    }
    seenForms.set(key, candidate);
    deduped.push(candidate);
  }

  // NORMALIZATION (por item) → CLUSTER de equivalência (canonicalId declarado
  // é a chave mais forte; anti-over-merge duro pelos exclusiveTokens).
  const withMapping = deduped.map((candidate) => {
    const normalized = normalizeFindingName({ externalName: candidate.externalName, kind: candidate.kind });
    if (normalized.reason === SEMANTIC_CODES.OVER_MERGE_REFUSED) {
      metrics.overMergeRejected += 1;
    }
    return { ...candidate, normalized };
  });

  const { clusters, overMergeRejected } = clusterCandidates(
    withMapping.map((candidate) => ({
      ...candidate,
      canonicalId: candidate.normalized.canonicalId,
    })),
  );
  metrics.overMergeRejected += overMergeRejected;

  // CANONICAL MAPPING: um representante por cluster.
  const candidates = [];
  for (const cluster of clusters) {
    const representative = cluster.members[0];
    const normalized = representative.normalized;
    const collapsedInCluster = cluster.size - 1;
    metrics.duplicatesCollapsed += collapsedInCluster;

    if (representative.kind === 'capability') metrics.normalizedCapabilities += 1;
    if (representative.kind === 'journey') metrics.normalizedJourneys += 1;
    if (representative.kind === 'businessRule') metrics.normalizedBusinessRules += 1;

    const { normalized: _normalized, ...representativeFields } = representative;
    candidates.push({
      ...representativeFields,
      semanticStatus: SEMANTIC_STATUS.NORMALIZED,
      normalizedId: normalized.canonicalId,
      canonicalId: normalized.canonicalId,
      clusterId: cluster.clusterId,
      clusterSize: cluster.size,
      confidence: representative.viaFaqAnswer ? 'OBSERVED_VIA_FAQ_ANSWER' : 'OBSERVED',
      normalizationRationale: normalized.canonicalId
        ? `declared_equivalence:${normalized.matchedTerm}`
        : (normalized.reason === SEMANTIC_CODES.OVER_MERGE_REFUSED
          ? SEMANTIC_CODES.OVER_MERGE_REFUSED
          : 'no_declared_equivalence'),
      variants: [...new Set(cluster.members.flatMap((member, index) => [
        ...(index > 0 ? [member.externalName] : []),
        ...(member.dedupedNames || []),
      ]))],
    });
  }

  return { candidates, unresolved, rejected, metrics };
}

/** Soma duas métricas do funil (documentação + API, multi-fonte). */
function mergePipelineMetrics(target, source) {
  const merged = { ...emptyMetrics(), ...(target || {}) };
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === 'number') merged[key] = (merged[key] || 0) + value;
  }
  return merged;
}

module.exports = {
  KIND_BY_SIGNAL,
  SEMANTIC_STATUS,
  emptyMetrics,
  mergePipelineMetrics,
  runNormalizationPipeline,
};
