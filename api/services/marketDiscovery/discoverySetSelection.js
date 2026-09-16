'use strict';

/**
 * discoverySetSelection — seleção DETERMINÍSTICA do Discovery Set a partir do
 * universo de candidatos aceitos.
 *
 * Critérios (todos declarados, nenhum opaco): cobertura de arquétipos,
 * diversidade, geografia, perfil de cliente, maturidade operacional,
 * profundidade de billing, experiência digital, maturidade de integração e
 * INDEPENDÊNCIA (grupo econômico efetivo — clone nunca conta duas vezes).
 *
 * Determinismo: pesos declarados em SELECTION_WEIGHTS, desempate por score →
 * candidate_key (lexicográfico). O mesmo universo produz SEMPRE o mesmo set,
 * e a rationale de cada seleção é persistida junto (prova de por que entrou).
 *
 * Este módulo é PURO (zero I/O).
 */

const { buildEffectiveGroupResolver, effectiveGroupsOf } = require('./independence');

/** Níveis ordinais de maturidade declarados no profile do candidato. */
const MATURITY_SCORE = Object.freeze({ high: 3, medium: 2, low: 1 });

/**
 * Pesos da seleção (declarados — thresholds não são constante escondida).
 * Cada dimensão contribui no máximo `weight` pontos para o score.
 */
const SELECTION_WEIGHTS = Object.freeze({
  archetypeCoverage: 40, // cobre arquétipo ACCEPTED ainda não representado
  independence: 20, // grupo econômico efetivo ainda não representado
  geography: 10, // geografia ainda não representada
  customerProfile: 8, // perfil de cliente/segmento ainda não representado
  operationalMaturity: 6, // profile.dimensions.operationalDepth
  billingDepth: 6, // profile.dimensions.financialDepth
  digitalExperience: 5, // profile.dimensions.customerEngagementDepth
  integrationMaturity: 5, // profile.dimensions.integrationMaturity
});

const DEFAULT_SET_SIZE = 8;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function maturityPoints(value, weight) {
  const points = MATURITY_SCORE[String(value ?? '').toLowerCase()] || 0;
  return (points / 3) * weight;
}

function round6(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

/**
 * Score de UM candidato contra o que o set em construção JÁ cobre.
 * Retorna score + breakdown auditável por dimensão.
 */
function scoreCandidate(candidate, context) {
  const {
    coveredArchetypes = new Set(),
    coveredGroups = new Set(),
    coveredGeographies = new Set(),
    coveredCustomerProfiles = new Set(),
    acceptedArchetypes = null,
    resolveGroup,
  } = context;

  const dimensions = (candidate?.profile && candidate.profile.dimensions) || {};
  const breakdown = [];
  let score = 0;

  // Cobertura de arquétipo: só contam arquétipos ACCEPTED (evidência) ainda
  // não representados. Arquétipo inventado no candidato não pontua.
  const candidateArchetypes = list(candidate?.archetypes)
    .filter((a) => !acceptedArchetypes || acceptedArchetypes.has(a));
  const newArchetypes = candidateArchetypes.filter((a) => !coveredArchetypes.has(a));
  if (newArchetypes.length > 0) {
    score += SELECTION_WEIGHTS.archetypeCoverage;
    breakdown.push({ dimension: 'archetypeCoverage', points: SELECTION_WEIGHTS.archetypeCoverage, newArchetypes });
  }

  const group = resolveGroup(candidate);
  if (!coveredGroups.has(group)) {
    score += SELECTION_WEIGHTS.independence;
    breakdown.push({ dimension: 'independence', points: SELECTION_WEIGHTS.independence, group });
  }

  const geography = candidate?.country || candidate?.region || null;
  if (isNonEmptyString(geography) && !coveredGeographies.has(String(geography))) {
    score += SELECTION_WEIGHTS.geography;
    breakdown.push({ dimension: 'geography', points: SELECTION_WEIGHTS.geography, geography: String(geography) });
  }

  const profiles = [...list(candidate?.segments), ...list(candidate?.targetCustomers)];
  const newProfiles = profiles.filter((p) => !coveredCustomerProfiles.has(p));
  if (newProfiles.length > 0) {
    score += SELECTION_WEIGHTS.customerProfile;
    breakdown.push({ dimension: 'customerProfile', points: SELECTION_WEIGHTS.customerProfile, newProfiles });
  }

  const operational = maturityPoints(dimensions.operationalDepth, SELECTION_WEIGHTS.operationalMaturity);
  const billing = maturityPoints(dimensions.financialDepth, SELECTION_WEIGHTS.billingDepth);
  const digital = maturityPoints(dimensions.customerEngagementDepth, SELECTION_WEIGHTS.digitalExperience);
  const integration = maturityPoints(dimensions.integrationMaturity, SELECTION_WEIGHTS.integrationMaturity);
  for (const [dimension, points] of [
    ['operationalMaturity', operational],
    ['billingDepth', billing],
    ['digitalExperience', digital],
    ['integrationMaturity', integration],
  ]) {
    if (points > 0) {
      score += points;
      breakdown.push({ dimension, points: round6(points) });
    }
  }

  return { score: round6(score), breakdown };
}

/**
 * Seleciona o Discovery Set (greedy determinístico com rationale persistível).
 *
 * Ciclo incremental (`excludeKeys`): candidatos JÁ PESQUISADOS (benchmarks com
 * `analyzedAt` no sample, identidade derivada por `researchedKeysFromSample`)
 * nunca voltam ao set — re-selecioná-los apagaria a novelty medida. A
 * cobertura PARTE do inventário já pesquisado: o set novo pontua o que
 * acrescenta ALÉM do que já se conhece. O resolver de grupo efetivo continua
 * enxergando os excluídos (clone de produto pesquisado não conta como grupo
 * novo).
 *
 * @param {object} args
 * @param {Array}  args.candidates  candidatos ACCEPTED do universo
 * @param {Array}  [args.acceptedArchetypeKeys] arquétipos ACCEPTED do run
 * @param {number} [args.size]
 * @param {Array}  [args.excludeKeys] identidades já pesquisadas (ciclo incremental)
 * @param {Array}  [args.reservedKeys] identidades do holdout pré-registrado
 *   não-analisado (run real r13): nunca entram no set (seriam pesquisadas como
 *   membro do set — leakage estrutural) e NÃO alimentam a cobertura (ainda são
 *   desconhecidas). Permanecem elegíveis na seleção de holdout.
 * @returns {{selected: string[], rationale: Array, excluded: Array, policy: object}}
 */
function selectDiscoverySet({ candidates, acceptedArchetypeKeys = null, size = DEFAULT_SET_SIZE, excludeKeys = [], reservedKeys = [] } = {}) {
  const pool = list(candidates).slice().sort((a, b) => String(a.candidateKey).localeCompare(String(b.candidateKey)));
  const acceptedArchetypes = Array.isArray(acceptedArchetypeKeys) ? new Set(acceptedArchetypeKeys) : null;
  const excludedKeys = new Set(list(excludeKeys).map((key) => String(key)));
  const reserved = new Set(list(reservedKeys).map((key) => String(key)));
  const resolveGroup = buildEffectiveGroupResolver(pool);
  const targetSize = Math.max(1, Number(size) || DEFAULT_SET_SIZE);

  const coveredArchetypes = new Set();
  const coveredGroups = new Set();
  const coveredGeographies = new Set();
  const coveredCustomerProfiles = new Set();

  const excluded = [];
  const remaining = [];
  for (const candidate of pool) {
    if (excludedKeys.has(String(candidate.candidateKey))) {
      // Já pesquisado: fora do set, mas o que ele cobre passa a ser CONHECIDO.
      excluded.push({ candidateKey: candidate.candidateKey, reason: 'already_researched', effectiveGroup: resolveGroup(candidate) });
      for (const a of list(candidate.archetypes)) {
        if (!acceptedArchetypes || acceptedArchetypes.has(a)) coveredArchetypes.add(a);
      }
      coveredGroups.add(resolveGroup(candidate));
      const geography = candidate.country || candidate.region || null;
      if (isNonEmptyString(geography)) coveredGeographies.add(String(geography));
      for (const p of [...list(candidate.segments), ...list(candidate.targetCustomers)]) coveredCustomerProfiles.add(p);
      continue;
    }
    if (reserved.has(String(candidate.candidateKey))) {
      // Holdout pré-registrado não-analisado: fora do set, e NADA do que ele
      // declara conta como conhecido — o holdout existe exatamente para medir
      // o que o inventário NÃO cobre.
      excluded.push({ candidateKey: candidate.candidateKey, reason: 'reserved_holdout_preregistered', effectiveGroup: resolveGroup(candidate) });
      continue;
    }
    remaining.push(candidate);
  }

  const selected = [];
  const rationale = [];

  while (selected.length < targetSize && remaining.length > 0) {
    let best = null;
    let bestScore = -1;
    let bestBreakdown = [];
    for (const candidate of remaining) {
      const { score, breakdown } = scoreCandidate(candidate, {
        coveredArchetypes,
        coveredGroups,
        coveredGeographies,
        coveredCustomerProfiles,
        acceptedArchetypes,
        resolveGroup,
      });
      // Desempate determinístico: score desc → candidate_key asc (pool já
      // ordenado por key, então o primeiro com score máximo vence).
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
        bestBreakdown = breakdown;
      }
    }
    if (!best) break;

    selected.push(best.candidateKey);
    rationale.push({
      candidateKey: best.candidateKey,
      order: selected.length,
      score: bestScore,
      effectiveGroup: resolveGroup(best),
      breakdown: bestBreakdown,
    });
    for (const a of list(best.archetypes)) coveredArchetypes.add(a);
    coveredGroups.add(resolveGroup(best));
    const geography = best.country || best.region || null;
    if (isNonEmptyString(geography)) coveredGeographies.add(String(geography));
    for (const p of [...list(best.segments), ...list(best.targetCustomers)]) coveredCustomerProfiles.add(p);
    remaining.splice(remaining.indexOf(best), 1);
  }

  for (const candidate of remaining) {
    excluded.push({ candidateKey: candidate.candidateKey, reason: 'not_selected_by_score', effectiveGroup: resolveGroup(candidate) });
  }

  return {
    selected,
    rationale,
    excluded,
    policy: {
      weights: { ...SELECTION_WEIGHTS },
      size: targetSize,
      tieBreak: 'score_desc__candidate_key_asc',
      independentGroupsCovered: effectiveGroupsOf(pool.filter((c) => selected.includes(c.candidateKey))).size,
    },
  };
}

/**
 * Escolhe o HOLDOUT entre os ACCEPTED fora do discovery set — ANTES de
 * qualquer pesquisa profunda. Critério determinístico: maximiza distância do
 * set (arquétipo não coberto, grupo não coberto, geografia não coberta);
 * desempate por candidate_key.
 *
 * Ciclo incremental (`excludeKeys`): um candidato JÁ PESQUISADO não pode ser
 * holdout (não é mais desconhecido) — e o que ele cobre conta como CONHECIDO
 * na medida de distância: o holdout mede a generalização do inventário
 * completo (set + já pesquisados), não só do set novo.
 *
 * @returns {{holdoutKey: string|null, basis: object}}
 */
function selectHoldout({ candidates, selectedKeys, acceptedArchetypeKeys = null, excludeKeys = [] } = {}) {
  const inSet = new Set(list(selectedKeys));
  const excludedKeys = new Set(list(excludeKeys).map((key) => String(key)));
  const pool = list(candidates).filter((c) => !inSet.has(c.candidateKey) && !excludedKeys.has(String(c.candidateKey)));
  if (pool.length === 0) return { holdoutKey: null, basis: { reason: 'no_candidate_outside_discovery_set' } };

  // Contexto de conhecimento = set novo + já pesquisados.
  const known = list(candidates).filter((c) => inSet.has(c.candidateKey) || excludedKeys.has(String(c.candidateKey)));
  const coveredArchetypes = new Set(known.flatMap((c) => list(c.archetypes)));
  const resolveGroup = buildEffectiveGroupResolver(list(candidates));
  const coveredGroups = new Set(known.map((c) => resolveGroup(c)));
  const coveredGeographies = new Set(known.map((c) => String(c.country || c.region || '')).filter(Boolean));
  const acceptedArchetypes = Array.isArray(acceptedArchetypeKeys) ? new Set(acceptedArchetypeKeys) : null;

  const scored = pool.map((candidate) => {
    let distance = 0;
    const reasons = [];
    const archetypes = list(candidate.archetypes).filter((a) => !acceptedArchetypes || acceptedArchetypes.has(a));
    const newArchetypes = archetypes.filter((a) => !coveredArchetypes.has(a));
    if (newArchetypes.length > 0) { distance += 4; reasons.push({ reason: 'archetype_not_covered', archetypes: newArchetypes }); }
    const group = resolveGroup(candidate);
    if (!coveredGroups.has(group)) { distance += 2; reasons.push({ reason: 'independence_group_not_covered', group }); }
    const geography = String(candidate.country || candidate.region || '');
    if (geography && !coveredGeographies.has(geography)) { distance += 1; reasons.push({ reason: 'geography_not_covered', geography }); }
    return { candidate, distance, reasons };
  });

  scored.sort((a, b) => (b.distance - a.distance) || a.candidate.candidateKey.localeCompare(b.candidate.candidateKey));
  const chosen = scored[0];
  return {
    holdoutKey: chosen.candidate.candidateKey,
    basis: {
      reason: 'maximiza distância do discovery set (arquétipo/grupo/geografia não cobertos)',
      distance: chosen.distance,
      factors: chosen.reasons,
      tieBreak: 'distance_desc__candidate_key_asc',
      alternatives: scored.slice(1).map((s) => ({ candidateKey: s.candidate.candidateKey, distance: s.distance })),
    },
  };
}

module.exports = {
  SELECTION_WEIGHTS,
  DEFAULT_SET_SIZE,
  MATURITY_SCORE,
  scoreCandidate,
  selectDiscoverySet,
  selectHoldout,
};
