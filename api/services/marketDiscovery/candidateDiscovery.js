'use strict';

/**
 * candidateDiscovery — universo de CANDIDATOS de mercado.
 *
 * Os concorrentes conhecidos do config da vertical (ex.: os 8 de
 * `config/benchmarks/fitness.json`) entram como SEED — entrada de referência,
 * NÃO a verdade. A descoberta pode (e deve) ACRESCENTAR candidatos novos
 * vindos dos resultados de pesquisa, e nenhum candidato — seed ou descoberto —
 * vira ACCEPTED sem `sourceEvidence` real: URL + (`evidenceRef` ou
 * `contentHash`) obtidos por capabilities governadas.
 *
 * "O agente achou relevante" sem evidência é REJEITADO: relevância declarada
 * não é prova de existência nem de pertencimento ao mercado.
 *
 * Este módulo é PURO (zero I/O).
 */

const { normalizeArchetypeKey, isValidEvidenceItem } = require('./archetypeDiscovery');

const CANDIDATE_STATES = Object.freeze({
  /** Seed de referência ou descoberto, ainda sem evidência suficiente. */
  EVIDENCE_REQUIRED: 'EVIDENCE_REQUIRED',
  /** Aceito no universo: evidência real liga o candidato ao mercado. */
  ACCEPTED: 'ACCEPTED',
  /** Rejeitado com motivo auditável (ex.: evidência contraditória). */
  REJECTED: 'REJECTED',
});

const CANDIDATE_ORIGINS = Object.freeze({
  SEED: 'seed',
  RESEARCH: 'research',
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function stringList(value) {
  return list(value).map((item) => String(item ?? '').trim()).filter(Boolean);
}

/** Chave estável do candidato (identidade de upsert idempotente). */
function normalizeCandidateKey(name) {
  return normalizeArchetypeKey(name);
}

/**
 * Veredito de aceitação de UM candidato. Saída auditável — nunca booleano solto.
 *
 * @returns {{accepted: boolean, state: string, reason: string, evidenceCount: number}}
 */
function evaluateCandidateAcceptance(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return { accepted: false, state: CANDIDATE_STATES.REJECTED, reason: 'candidate_record_missing', evidenceCount: 0 };
  }
  if (!isNonEmptyString(candidate.name)) {
    return { accepted: false, state: CANDIDATE_STATES.REJECTED, reason: 'candidate_name_missing', evidenceCount: 0 };
  }
  const evidence = list(candidate.sourceEvidence).filter(isValidEvidenceItem);
  if (evidence.length === 0) {
    return {
      accepted: false,
      state: CANDIDATE_STATES.EVIDENCE_REQUIRED,
      reason: list(candidate.sourceEvidence).length > 0 ? 'candidate_evidence_invalid' : 'candidate_without_evidence',
      evidenceCount: 0,
    };
  }
  if (evidence.every((item) => item.contradicts === true)) {
    return { accepted: false, state: CANDIDATE_STATES.REJECTED, reason: 'candidate_contradicted_by_evidence', evidenceCount: evidence.length };
  }
  return { accepted: true, state: CANDIDATE_STATES.ACCEPTED, reason: 'candidate_evidence_accepted', evidenceCount: evidence.length };
}

/**
 * Normaliza um registro de candidato. O estado é computado da evidência —
 * o chamador não escolhe ACCEPTED.
 *
 * Campos do registro: name, vendor, officialSite, officialDocs, apiDocs,
 * country/region, segments, targetCustomers, archetypes, independenceGroup,
 * cloneOf/baseProduct, sourceEvidence, rationale.
 */
function buildCandidateRecord({
  vertical,
  name,
  vendor = null,
  officialSite = null,
  officialDocs = null,
  apiDocs = null,
  country = null,
  region = null,
  segments = [],
  targetCustomers = [],
  archetypes = [],
  independenceGroup = null,
  cloneOf = null,
  baseProduct = null,
  sourceEvidence = [],
  rationale = null,
  origin = CANDIDATE_ORIGINS.RESEARCH,
  metadata = {},
}) {
  const candidateKey = normalizeCandidateKey(name);
  const normalizedEvidence = list(sourceEvidence).map((item) => ({
    url: String(item?.url ?? ''),
    evidenceRef: item?.evidenceRef ? String(item.evidenceRef) : null,
    contentHash: item?.contentHash ? String(item.contentHash) : null,
    tier: Number.isFinite(Number(item?.tier)) ? Number(item.tier) : null,
    contradicts: item?.contradicts === true,
    note: item?.note ? String(item.note) : null,
  }));
  const verdict = evaluateCandidateAcceptance({ name, sourceEvidence: normalizedEvidence });
  return {
    vertical: String(vertical ?? '').trim(),
    candidateKey,
    name: String(name ?? '').trim(),
    vendor: vendor ? String(vendor) : null,
    officialSite: officialSite ? String(officialSite) : null,
    officialDocs: officialDocs ? String(officialDocs) : null,
    apiDocs: apiDocs ? String(apiDocs) : null,
    country: country ? String(country) : null,
    region: region ? String(region) : null,
    segments: stringList(segments),
    targetCustomers: stringList(targetCustomers),
    archetypes: stringList(archetypes).map(normalizeArchetypeKey),
    independenceGroup: independenceGroup ? String(independenceGroup) : null,
    cloneOf: cloneOf ? normalizeCandidateKey(cloneOf) : null,
    baseProduct: baseProduct ? String(baseProduct) : null,
    origin: origin === CANDIDATE_ORIGINS.SEED ? CANDIDATE_ORIGINS.SEED : CANDIDATE_ORIGINS.RESEARCH,
    state: verdict.state,
    sourceEvidence: normalizedEvidence,
    rationale: rationale ? String(rationale) : verdict.reason,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };
}

/**
 * Converte um benchmark do sample do config em SEED de referência. Seeds não
 * carregam evidência de pesquisa deste run — entram como EVIDENCE_REQUIRED e
 * precisam ser confirmados pela descoberta como qualquer candidato.
 */
function seedFromBenchmark(vertical, benchmark) {
  const primarySource = list(benchmark?.sources).find((source) => isNonEmptyString(source?.url));
  return {
    vertical,
    name: benchmark?.name || benchmark?.id,
    vendor: benchmark?.vendor || null,
    officialSite: primarySource?.url || null,
    officialDocs: null,
    apiDocs: null,
    country: benchmark?.dimensions?.geography || null,
    region: null,
    segments: [],
    targetCustomers: benchmark?.dimensions?.customerSize ? [benchmark.dimensions.customerSize] : [],
    archetypes: benchmark?.archetype ? [benchmark.archetype] : [],
    independenceGroup: benchmark?.independenceGroup || null,
    cloneOf: benchmark?.cloneOf || null,
    baseProduct: benchmark?.baseProduct || null,
    sourceEvidence: [],
    rationale: 'seed de referência do config da vertical; aguardando confirmação por pesquisa',
    origin: CANDIDATE_ORIGINS.SEED,
    metadata: { seedBenchmarkId: benchmark?.id || null, seedRole: benchmark?.role || null },
  };
}

/**
 * Funde SEEDS + resultados de pesquisa no universo de candidatos.
 *
 * Merge por `candidateKey`: quando a pesquisa confirma um seed, a evidência é
 * ACRESCENTADA ao registro do seed (o seed sai de EVIDENCE_REQUIRED para o
 * estado que a evidência justificar) — nunca nasce um segundo candidato.
 * Candidatos NOVOS (além dos seeds) entram normalmente, com evidência.
 *
 * @returns {{candidates: Array, rejected: Array, stats: object}}
 */
function discoverCandidates({ vertical, seeds = [], researchResults = [] }) {
  const byKey = new Map();

  for (const seed of list(seeds)) {
    const record = buildCandidateRecord({ ...seed, vertical, origin: CANDIDATE_ORIGINS.SEED });
    if (!record.candidateKey) continue;
    byKey.set(record.candidateKey, record);
  }

  for (const found of list(researchResults)) {
    const key = normalizeCandidateKey(found?.name);
    if (!key) continue;
    const existing = byKey.get(key);
    const mergedEvidence = [
      ...list(existing?.sourceEvidence),
      ...list(found?.sourceEvidence),
    ];
    const record = buildCandidateRecord({
      ...(existing || {}),
      ...Object.fromEntries(Object.entries(found || {}).filter(([, value]) => value !== null && value !== undefined)),
      vertical,
      // A origem do seed é preservada no merge: ser seed não é demérito nem
      // privilégio — o que decide é a evidência acumulada.
      origin: existing ? existing.origin : CANDIDATE_ORIGINS.RESEARCH,
      sourceEvidence: mergedEvidence,
      rationale: found?.rationale
        || (existing ? 'seed confirmado por evidência de pesquisa' : null),
      metadata: { ...(existing?.metadata || {}), ...(found?.metadata || {}) },
    });
    byKey.set(key, record);
  }

  const candidates = [...byKey.values()]
    .sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));

  return {
    candidates,
    accepted: candidates.filter((c) => c.state === CANDIDATE_STATES.ACCEPTED),
    evidenceRequired: candidates.filter((c) => c.state === CANDIDATE_STATES.EVIDENCE_REQUIRED),
    rejected: candidates
      .filter((c) => c.state === CANDIDATE_STATES.REJECTED)
      .map((c) => ({ candidateKey: c.candidateKey, rationale: c.rationale })),
    stats: {
      seeds: list(seeds).length,
      researchResults: list(researchResults).length,
      universe: candidates.length,
      beyondSeeds: candidates.filter((c) => c.origin === CANDIDATE_ORIGINS.RESEARCH).length,
    },
  };
}

module.exports = {
  CANDIDATE_STATES,
  CANDIDATE_ORIGINS,
  normalizeCandidateKey,
  evaluateCandidateAcceptance,
  buildCandidateRecord,
  seedFromBenchmark,
  discoverCandidates,
};
