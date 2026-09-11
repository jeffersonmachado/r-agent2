'use strict';

/**
 * benchmarkSufficiencyEngine — motor PURO (zero I/O) que responde:
 *
 *   "O conjunto de benchmarks escolhido para esta vertical representa
 *    suficientemente o mercado para permitir considerar seu inventário de
 *    capacidades e jornadas materialmente completo?"
 *
 * Regra fundamental: BENCHMARK_COUNT != SAMPLE_SUFFICIENCY. Quantidade de logos
 * nunca certifica; arquétipos representados, novidade incremental, saturação,
 * holdout pré-registrado, qualidade/frescor da fonte e robustez de ordem sim.
 *
 * O engine não decide o que é novidade: ele recebe REGISTROS DE DESCOBERTA
 * versionados (o que cada benchmark acrescentou, na ordem registrada) e valida
 * consistência, cobertura e saturação. Recalcular histórico silenciosamente não
 * é possível por construção — `previousInventorySize` é conferido contra a soma
 * das contribuições anteriores (inventoryArithmetic).
 */

const SAMPLE_STATES = Object.freeze({
  NOT_RESEARCHED: 'SAMPLE_NOT_RESEARCHED',
  RESEARCHING: 'SAMPLE_RESEARCHING',
  NOT_SATURATED: 'SAMPLE_NOT_SATURATED',
  HOLDOUT_FAILED: 'SAMPLE_HOLDOUT_FAILED',
  REVALIDATION_REQUIRED: 'SAMPLE_REVALIDATION_REQUIRED',
  SUFFICIENT: 'SAMPLE_SUFFICIENT',
});

/** Estado externo (não é falha do RAP, é bloqueio de pesquisa). */
const EXTERNAL_BLOCK_STATE = 'SAMPLE_CERTIFICATION_BLOCKED_BY_EXTERNAL_RESEARCH';

const NOVELTY_KEYS = Object.freeze({
  capabilities: 'newCapabilities',
  requiredCapabilities: 'newRequiredCapabilities',
  criticalCapabilities: 'newCriticalCapabilities',
  journeys: 'newJourneys',
  requiredJourneys: 'newRequiredJourneys',
  criticalJourneys: 'newCriticalJourneys',
  businessRules: 'newBusinessRules',
  requiredBusinessRules: 'newRequiredBusinessRules',
  criticalBusinessRules: 'newCriticalBusinessRules',
});

const ALL_NOVELTY_KEYS = Object.freeze(Object.values(NOVELTY_KEYS));

function emptyNovelty() {
  return Object.fromEntries(ALL_NOVELTY_KEYS.map((k) => [k, []]));
}

function status(passed, detail = {}, extra = {}) {
  return { status: passed ? 'PASS' : 'FAIL', ...detail, ...extra };
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function round6(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6;
}

/** Discovery set = benchmarks com role 'discovery', na ordem registrada. */
function discoveryBenchmarks(sample) {
  return list(sample.benchmarks)
    .filter((b) => b.role === 'discovery')
    .slice()
    .sort((a, b) => Number(a.order) - Number(b.order));
}

function validationBenchmarks(sample) {
  return list(sample.benchmarks).filter((b) => b.role === 'validation');
}

// ── §12 Arquétipos ────────────────────────────────────────────────────────

/**
 * Cobertura de arquétipos relevantes.
 * Arquétipo REQUIRED/RELEVANT sem benchmark representante PRECISA de
 * MARKET_SCARCITY_EXCEPTION justificada — ignorar não é opção.
 */
function evaluateArchetypeCoverage({ sample }) {
  const archetypes = list(sample.archetypes);
  const relevant = archetypes.filter((a) => ['REQUIRED', 'RELEVANT'].includes(String(a.importance).toUpperCase()));
  const represented = [];
  const missing = [];

  for (const archetype of relevant) {
    const hasBenchmark = list(sample.benchmarks).some((b) => b.archetype === archetype.id);
    if (hasBenchmark && String(archetype.status || 'ACTIVE').toUpperCase() !== 'NO_BENCHMARK_AVAILABLE') {
      represented.push(archetype.id);
    } else {
      const exception = list(sample.marketScarcityExceptions).find((e) => e.archetype === archetype.id);
      if (exception && exception.evidence) {
        represented.push(`${archetype.id} (scarcity)`);
      } else {
        missing.push(archetype.id);
      }
    }
  }

  const coverageRate = relevant.length > 0 ? round6(represented.length / relevant.length) : 1;
  return status(missing.length === 0, {
    relevantArchetypes: relevant.length,
    representedArchetypes: represented.length,
    coverageRate,
    missingArchetypes: missing,
    exceptions: list(sample.marketScarcityExceptions),
  });
}

// ── §29 Independência corporativa ─────────────────────────────────────────

/** Benchmarks do mesmo independence_group NÃO são observações independentes. */
function evaluateIndependence({ sample }) {
  const benchmarks = list(sample.benchmarks);
  const groups = new Map();
  for (const b of benchmarks) {
    const group = String(b.independenceGroup || b.id);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(b.id);
  }
  const duplicated = [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([group, ids]) => ({ group, ids }));
  const discovery = discoveryBenchmarks(sample);
  const independentDiscovery = new Set(discovery.map((b) => String(b.independenceGroup || b.id))).size;
  const discoveryGroups = new Set(discovery.map((b) => String(b.independenceGroup || b.id))).size;

  return status(true, {
    independenceGroups: [...groups.keys()],
    groups: [...groups.entries()].map(([group, ids]) => ({ group, ids })),
    discoveryGroups,
    independentDiscoveryBenchmarks: independentDiscovery,
    duplicatedGroups: duplicated,
  });
}

/**
 * §27/§43 Clones e diversidade falsa: white-labels, mesmo produto base,
 * fornecedores que convergiram. `cloneOf` é declaração explícita e auditável.
 */
function detectCorrelatedCloneBenchmarks({ sample }) {
  const benchmarks = list(sample.benchmarks);
  const clones = [];
  const seen = new Map();
  // Um clone herda o GRUPO do alvo declarado: white-label não conta como
  // observação independente só porque recebeu um independenceGroup próprio.
  const groupById = new Map(benchmarks.map((b) => [b.id, String(b.independenceGroup || b.id)]));
  const effectiveGroup = (b) => {
    const parent = b.cloneOf || b.baseProduct;
    if (parent && groupById.has(String(parent))) return groupById.get(String(parent));
    return String(b.cloneOf || b.baseProduct || b.independenceGroup || b.id);
  };

  for (const b of benchmarks) {
    const key = String(b.cloneOf || b.baseProduct || b.id);
    if (b.cloneOf || b.baseProduct) {
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(b.id);
      clones.push({ benchmarkId: b.id, cloneOf: key });
    }
  }
  const discovery = discoveryBenchmarks(sample);
  const discoverySources = new Set(discovery.map((b) => effectiveGroup(b)));
  const independentShare = discovery.length > 0 ? round6(discoverySources.size / discovery.length) : 1;
  return {
    cloneDeclarations: clones,
    independentShare,
    correlatedProducts: [...seen.entries()].map(([k, ids]) => ({ product: k, ids })),
  };
}

// ── §13 Diversidade ───────────────────────────────────────────────────────

/** Diversidade por dimensões explícitas (sem score opaco). */
function evaluateDiversity({ sample, policy }) {
  const benchmarks = list(sample.benchmarks);
  const dimensions = list(sample.diversityDimensions).length > 0 ? sample.diversityDimensions : list(policy.dimensions);
  const concentrations = [];

  for (const dimension of dimensions) {
    const values = benchmarks.map((b) => (b.dimensions ? b.dimensions[dimension] : undefined)).filter((v) => v !== undefined && v !== null);
    if (values.length === 0) continue;
    const counts = new Map();
    for (const value of values) counts.set(String(value), (counts.get(String(value)) || 0) + 1);
    const [topValue, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    concentrations.push({
      dimension,
      distinctValues: counts.size,
      topValue,
      topShare: round6(topCount / values.length),
    });
  }

  const archetypeConcentration = concentrations.find((c) => c.dimension === 'marketArchetype');
  const geographyConcentration = concentrations.find((c) => c.dimension === 'geography');
  const cloneInfo = detectCorrelatedCloneBenchmarks({ sample });
  const concentrationBreakdown = [];

  if (archetypeConcentration && archetypeConcentration.topShare > Number(policy.maximumSingleArchetypeShare)) {
    concentrationBreakdown.push({ reason: 'single_archetype_share_exceeded', dimension: 'marketArchetype', share: archetypeConcentration.topShare });
  }
  if (geographyConcentration && geographyConcentration.topShare > Number(policy.maximumSingleCountryShare)) {
    concentrationBreakdown.push({ reason: 'single_geography_share_exceeded', dimension: 'geography', share: geographyConcentration.topShare });
  }
  const cloneShare = 1 - cloneInfo.independentShare;
  if (cloneShare > Number(policy.maximumCloneShare)) {
    concentrationBreakdown.push({ reason: 'clone_share_exceeded', share: round6(cloneShare) });
  }

  const archetypeCount = new Set(benchmarks.map((b) => b.archetype).filter(Boolean)).size;
  if (archetypeCount < Number(policy.minimumDistinctArchetypes)) {
    concentrationBreakdown.push({ reason: 'distinct_archetypes_below_minimum', distinct: archetypeCount });
  }

  const joinedArchetypeCoverage = evaluateArchetypeCoverage({ sample });
  if (joinedArchetypeCoverage.status === 'FAIL') {
    concentrationBreakdown.push({ reason: 'archetype_coverage_incomplete', missing: joinedArchetypeCoverage.missingArchetypes });
  }

  return status(concentrationBreakdown.length === 0, {
    dimensionsEvaluated: dimensions,
    concentrations,
    violations: concentrationBreakdown,
  });
}

// ── §7 Curva de descoberta ────────────────────────────────────────────────

/**
 * Constrói a curva registrada. `previousInventorySize` é conferido contra a
 * soma acumulada das contribuições anteriores — impede "remover capability do
 * denominador" e recálculo silencioso do histórico.
 */
function buildDiscoveryCurve({ sample }) {
  const ordered = discoveryBenchmarks(sample);
  const points = [];
  let cumulative = 0;
  const arithmeticViolations = [];

  for (const benchmark of ordered) {
    const novelty = benchmark.novelty || emptyNovelty();
    const previousInventorySize = Number(benchmark.previousInventorySize);
    const expected = cumulative;

    if (Number.isFinite(previousInventorySize) && previousInventorySize !== expected) {
      arithmeticViolations.push({
        benchmarkId: benchmark.id,
        declared: previousInventorySize,
        expectedFromCurve: expected,
      });
    }

    const newCapabilities = list(novelty[NOVELTY_KEYS.capabilities]);
    const noveltyRate = expected > 0 ? round6(newCapabilities.length / expected) : null;
    const newCriticalCapabilities = list(novelty[NOVELTY_KEYS.criticalCapabilities]);
    const newRequiredCapabilities = list(novelty[NOVELTY_KEYS.requiredCapabilities]);

    points.push({
      benchmarkId: benchmark.id,
      order: Number(benchmark.order),
      independenceGroup: String(benchmark.independenceGroup || benchmark.id),
      archetype: benchmark.archetype || null,
      previousInventorySize: Number.isFinite(previousInventorySize) ? previousInventorySize : expected,
      newCapabilities: newCapabilities.length,
      newRequiredCapabilities: newRequiredCapabilities.length,
      newCriticalCapabilities: newCriticalCapabilities.length,
      newJourneys: list(novelty[NOVELTY_KEYS.journeys]).length,
      newRequiredJourneys: list(novelty[NOVELTY_KEYS.requiredJourneys]).length,
      newCriticalJourneys: list(novelty[NOVELTY_KEYS.criticalJourneys]).length,
      newBusinessRules: list(novelty[NOVELTY_KEYS.businessRules]).length,
      newRequiredBusinessRules: list(novelty[NOVELTY_KEYS.requiredBusinessRules]).length,
      newCriticalBusinessRules: list(novelty[NOVELTY_KEYS.criticalBusinessRules]).length,
      noveltyRate,
    });

    cumulative = expected + newCapabilities.length;
  }

  return { points, inventorySize: cumulative, arithmeticViolations };
}

// ── §9/§10/§11 Saturação ──────────────────────────────────────────────────

/** Seleciona a janela de saturação com observações INDEPENDENTES. */
function saturationWindowPoints(curve, policy) {
  const windowSize = Math.max(1, Number(policy.saturationWindow) || 1);
  const seenGroups = new Set();
  const independent = [];
  for (const point of curve.points) {
    if (seenGroups.has(point.independenceGroup)) continue;
    seenGroups.add(point.independenceGroup);
    independent.push(point);
  }
  return independent.slice(-windowSize);
}

function evaluateSaturation({ sample, policy }) {
  const curve = buildDiscoveryCurve({ sample });
  const window = saturationWindowPoints(curve, policy);
  const insufficientWindow = window.length < Math.max(1, Number(policy.saturationWindow) || 1);

  const checks = {
    capabilities: window.every((p) => (
      p.newCriticalCapabilities <= Number(policy.maxNewCriticalRequiredCapabilitiesInWindow)
      && p.newRequiredCapabilities <= Number(policy.maxNewCriticalRequiredCapabilitiesInWindow)
      && (p.noveltyRate === null || p.noveltyRate <= Number(policy.maxNoncriticalCapabilityNoveltyRate))
    )),
    journeys: window.every((p) => (
      p.newCriticalJourneys <= Number(policy.maxNewCriticalRequiredJourneysInWindow)
      && p.newRequiredJourneys <= Number(policy.maxNewCriticalRequiredJourneysInWindow)
      && (p.previousInventorySize === 0 || p.newJourneys / Math.max(p.previousInventorySize, 1) <= Number(policy.maxNoncriticalJourneyNoveltyRate))
    )),
    businessRules: window.every((p) => (
      p.newCriticalBusinessRules <= Number(policy.maxNewCriticalRequiredBusinessRulesInWindow)
      && p.newRequiredBusinessRules <= Number(policy.maxNewCriticalRequiredBusinessRulesInWindow)
      && (p.previousInventorySize === 0 || p.newBusinessRules / Math.max(p.previousInventorySize, 1) <= Number(policy.maxNoncriticalBusinessRuleNoveltyRate))
    )),
  };

  const describe = (key) => status(!insufficientWindow && checks[key], {
    window: window.map((p) => p.benchmarkId),
    windowSize: window.length,
    insufficientWindow,
    thresholds: {
      maxNoncriticalNoveltyRate: key === 'capabilities'
        ? policy.maxNoncriticalCapabilityNoveltyRate
        : (key === 'journeys' ? policy.maxNoncriticalJourneyNoveltyRate : policy.maxNoncriticalBusinessRuleNoveltyRate),
      maxNewCriticalRequired: key === 'capabilities'
        ? policy.maxNewCriticalRequiredCapabilitiesInWindow
        : (key === 'journeys' ? policy.maxNewCriticalRequiredJourneysInWindow : policy.maxNewCriticalRequiredBusinessRulesInWindow),
    },
  });

  return {
    curve,
    window,
    capability: describe('capabilities'),
    journey: describe('journeys'),
    businessRule: describe('businessRules'),
  };
}

// ── §14/§15/§16 Holdout ───────────────────────────────────────────────────

/**
 * Valida o holdout pré-registrado. Falhas absolutas:
 * - novelty crítico REQUIRED em capability/jornada/regra de negócio;
 * - ausência de pré-registro;
 * - leakage (holdout analisado antes de ser reservado, ou usado como discovery).
 */
function evaluateHoldout({ sample, policy }) {
  const holdoutRecord = sample.holdout || null;
  const validation = validationBenchmarks(sample);
  const violations = [];

  if (!holdoutRecord) {
    return status(false, {
      holdoutId: null,
      violations: [{ reason: 'holdout_not_preregistered' }],
      requiredPreregistrationFields: ['benchmarkId', 'selectedAsHoldoutAt', 'selectionReason', 'selectionEvidence', 'marketArchetype', 'inventoryVersion'],
    });
  }

  for (const field of ['benchmarkId', 'selectedAsHoldoutAt', 'selectionReason', 'selectionEvidence', 'marketArchetype', 'inventoryVersion']) {
    if (!holdoutRecord[field]) violations.push({ reason: 'holdout_preregistration_incomplete', field });
  }

  const benchmark = validation.find((b) => b.id === holdoutRecord.benchmarkId) || null;
  if (!benchmark) {
    violations.push({ reason: 'holdout_benchmark_not_found', benchmarkId: holdoutRecord.benchmarkId });
    return status(false, { holdoutId: holdoutRecord.benchmarkId, violations });
  }

  // Anti-leakage temporal: o holdout não pode ter sido analisado antes de ser reservado.
  const selectedAt = Date.parse(holdoutRecord.selectedAsHoldoutAt);
  const analyzedAt = benchmark.analyzedAt ? Date.parse(benchmark.analyzedAt) : null;
  if (Number.isFinite(selectedAt) && Number.isFinite(analyzedAt) && analyzedAt < selectedAt) {
    violations.push({
      reason: 'holdout_leakage_analyzed_before_preregistration',
      selectedAsHoldoutAt: holdoutRecord.selectedAsHoldoutAt,
      analyzedAt: benchmark.analyzedAt,
    });
  }
  if (holdoutRecord.selectedAsHoldoutAt && holdoutRecord.selectedAsHoldoutAt === holdoutRecord.analyzedAt) {
    violations.push({ reason: 'holdout_preregistration_same_instant_as_analysis' });
  }

  const novelty = benchmark.novelty || emptyNovelty();
  const newCriticalCapabilities = list(novelty[NOVELTY_KEYS.criticalCapabilities]);
  const newCriticalRequiredCapabilities = newCriticalCapabilities.filter((c) => c.required !== false);
  const newCriticalJourneys = list(novelty[NOVELTY_KEYS.criticalJourneys]);
  const newCriticalBusinessRules = list(novelty[NOVELTY_KEYS.criticalBusinessRules]);
  const newCapabilities = list(novelty[NOVELTY_KEYS.capabilities]);
  const priorInventorySize = Number(benchmark.previousInventorySize) || 0;
  const noncriticalRate = priorInventorySize > 0 ? round6(newCapabilities.length / priorInventorySize) : (newCapabilities.length > 0 ? 1 : 0);

  if (newCriticalRequiredCapabilities.length > Number(policy.maxHoldoutNewCriticalRequiredCapabilities)) {
    violations.push({ reason: 'holdout_new_critical_required_capabilities', items: newCriticalRequiredCapabilities });
  }
  if (newCriticalJourneys.length > Number(policy.maxHoldoutNewCriticalRequiredJourneys)) {
    violations.push({ reason: 'holdout_new_critical_journeys', items: newCriticalJourneys });
  }
  if (newCriticalBusinessRules.length > Number(policy.maxHoldoutNewCriticalRequiredBusinessRules)) {
    violations.push({ reason: 'holdout_new_critical_business_rules', items: newCriticalBusinessRules });
  }
  if (noncriticalRate > Number(policy.maxHoldoutNoncriticalNoveltyRate)) {
    violations.push({ reason: 'holdout_noncritical_novelty_rate_exceeded', rate: noncriticalRate, threshold: policy.maxHoldoutNoncriticalNoveltyRate });
  }

  return status(violations.length === 0, {
    holdoutId: benchmark.id,
    marketArchetype: holdoutRecord.marketArchetype,
    preRegisteredAt: holdoutRecord.selectedAsHoldoutAt,
    analyzedAt: benchmark.analyzedAt || null,
    inventoryVersion: holdoutRecord.inventoryVersion,
    newCapabilities: newCapabilities.length,
    newRequiredCapabilities: list(novelty[NOVELTY_KEYS.requiredCapabilities]).length,
    newCriticalCapabilities: newCriticalCapabilities.length,
    newJourneys: list(novelty[NOVELTY_KEYS.journeys]).length,
    newRequiredJourneys: list(novelty[NOVELTY_KEYS.requiredJourneys]).length,
    newCriticalJourneys: newCriticalJourneys.length,
    newBusinessRules: list(novelty[NOVELTY_KEYS.businessRules]).length,
    newRequiredBusinessRules: list(novelty[NOVELTY_KEYS.requiredBusinessRules]).length,
    newCriticalBusinessRules: newCriticalBusinessRules.length,
    noncriticalNoveltyRate: noncriticalRate,
    violations,
  });
}

// ── §17 Leave-one-out ─────────────────────────────────────────────────────

/** Sensibilidade: quanto do inventário depende de UM benchmark. */
function evaluateLeaveOneOut({ sample }) {
  const ordered = discoveryBenchmarks(sample);
  const items = ordered.map((benchmark) => {
    const novelty = benchmark.novelty || emptyNovelty();
    const uniqueCapabilities = list(novelty[NOVELTY_KEYS.capabilities]);
    const uniqueJourneys = list(novelty[NOVELTY_KEYS.journeys]);
    const uniqueCriticalRules = list(novelty[NOVELTY_KEYS.criticalBusinessRules]);
    const archetypeStillRepresented = list(sample.benchmarks).some((b) => b.id !== benchmark.id && b.archetype === benchmark.archetype);
    return {
      benchmarkId: benchmark.id,
      archetype: benchmark.archetype || null,
      uniqueCapabilities: uniqueCapabilities.length,
      uniqueRequiredCapabilities: list(novelty[NOVELTY_KEYS.requiredCapabilities]).length,
      uniqueJourneys: uniqueJourneys.length,
      uniqueCriticalBusinessRules: uniqueCriticalRules.length,
      archetypeWouldBeLost: !archetypeStillRepresented,
    };
  });

  const totalUnique = items.reduce((acc, item) => acc + item.uniqueCapabilities, 0);
  const top = items.slice().sort((a, b) => b.uniqueCapabilities - a.uniqueCapabilities)[0] || null;
  return {
    items,
    concentration: {
      topBenchmarkId: top ? top.benchmarkId : null,
      topShare: totalUnique > 0 && top ? round6(top.uniqueCapabilities / totalUnique) : null,
      archetypesLost: items.filter((i) => i.archetypeWouldBeLost).map((i) => i.archetype),
    },
  };
}

// ── §28 Sensibilidade de ordem ────────────────────────────────────────────

/** Recalcula a saturação sob ordens alternativas determinísticas. */
function evaluateOrderSensitivity({ sample, policy }) {
  const ordered = discoveryBenchmarks(sample);
  const baseline = evaluateSaturation({ sample, policy });
  const baselineVerdict = baseline.capability.status === 'PASS' && baseline.journey.status === 'PASS' && baseline.businessRule.status === 'PASS';

  const rotations = Math.min(Math.max(1, Number(policy.orderSensitivityPermutations) || 1), Math.max(1, ordered.length));
  const variants = [];
  for (let i = 1; i <= rotations; i += 1) {
    const rotated = ordered.slice(i).concat(ordered.slice(0, i));
    const rotatedSample = { ...sample, benchmarks: list(sample.benchmarks).map((b) => {
      const position = rotated.findIndex((r) => r.id === b.id);
      return position === -1 ? b : { ...b, order: position + 1 };
    }) };
    const result = evaluateSaturation({ sample: rotatedSample, policy });
    const verdict = result.capability.status === 'PASS' && result.journey.status === 'PASS' && result.businessRule.status === 'PASS';
    variants.push({ rotation: i, order: rotated.map((b) => b.id), verdict });
  }

  const divergence = variants.filter((v) => v.verdict !== baselineVerdict);
  const stable = divergence.length === 0;
  return status(stable || policy.orderSensitivityMustBeStable === false, {
    baselineOrder: ordered.map((b) => b.id),
    baselineVerdict,
    variants,
    divergenceCount: divergence.length,
    orderSensitivity: stable ? 'LOW' : 'HIGH',
  });
}

// ── §18/§19 Fontes e frescor ──────────────────────────────────────────────

function evaluateSourceQuality({ sample, policy }) {
  const violations = [];
  const minTier = Number(policy.minimumAcceptedSourceTier) || 5;
  for (const benchmark of list(sample.benchmarks)) {
    const sources = list(benchmark.sources);
    if (sources.length === 0) {
      violations.push({ benchmarkId: benchmark.id, reason: 'benchmark_without_source' });
      continue;
    }
    const bestTier = Math.min(...sources.map((s) => Number(s.tier) || 99));
    if (bestTier > minTier) {
      violations.push({ benchmarkId: benchmark.id, reason: 'source_tier_below_minimum', bestTier, minTier });
    }
    const novelty = benchmark.novelty || emptyNovelty();
    const criticalItems = [
      ...list(novelty[NOVELTY_KEYS.criticalCapabilities]).map((c) => ({ kind: 'capability', id: c.id || c })),
      ...list(novelty[NOVELTY_KEYS.criticalJourneys]).map((c) => ({ kind: 'journey', id: c.id || c })),
      ...list(novelty[NOVELTY_KEYS.criticalBusinessRules]).map((c) => ({ kind: 'rule', id: c.id || c })),
    ];
    if (criticalItems.length > 0 && bestTier > 6) {
      violations.push({
        benchmarkId: benchmark.id,
        reason: 'critical_finding_supported_only_by_low_confidence_source',
        bestTier,
        items: criticalItems,
      });
    }
    if (criticalItems.length > 0 && sources.every((s) => s.verified !== true)) {
      violations.push({ benchmarkId: benchmark.id, reason: 'critical_finding_without_verified_source', items: criticalItems });
    }
  }
  return status(violations.length === 0, { violations, minimumAcceptedSourceTier: minTier });
}

function evaluateFreshness({ sample, policy, now = new Date() }) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const maxSourceAgeMs = Number(policy.maximumSourceAgeDays) * 86400000;
  const maxReviewAgeMs = Number(policy.maximumBenchmarkReviewAgeDays) * 86400000;
  const items = [];
  const violations = [];

  for (const benchmark of list(sample.benchmarks)) {
    const researchedAt = benchmark.freshness && benchmark.freshness.researchedAt ? Date.parse(benchmark.freshness.researchedAt) : NaN;
    const reviewAt = benchmark.freshness && benchmark.freshness.nextReviewAt ? Date.parse(benchmark.freshness.nextReviewAt) : NaN;
    const declaredStatus = benchmark.freshness && benchmark.freshness.status ? String(benchmark.freshness.status).toUpperCase() : null;

    if (!Number.isFinite(researchedAt)) {
      violations.push({ benchmarkId: benchmark.id, reason: 'missing_researched_at' });
      items.push({ benchmarkId: benchmark.id, status: 'UNKNOWN' });
      continue;
    }

    const ageMs = nowMs - researchedAt;
    const stale = ageMs > maxSourceAgeMs;
    const reviewOverdue = Number.isFinite(reviewAt) && reviewAt < nowMs;
    const effective = declaredStatus === 'STALE' ? 'STALE' : (stale || reviewOverdue ? 'STALE' : 'FRESH');
    items.push({
      benchmarkId: benchmark.id,
      researchedAt: benchmark.freshness.researchedAt,
      ageDays: Math.round(ageMs / 86400000),
      nextReviewAt: benchmark.freshness.nextReviewAt || null,
      sourceLastUpdated: benchmark.freshness.sourceLastUpdated || null,
      status: effective,
    });
    if (effective === 'STALE') {
      violations.push({
        benchmarkId: benchmark.id,
        reason: reviewOverdue && !stale ? 'review_overdue' : 'source_older_than_policy',
        ageDays: Math.round(ageMs / 86400000),
      });
    }
  }
  return status(violations.length === 0, { items, violations, maximumSourceAgeDays: policy.maximumSourceAgeDays, maximumBenchmarkReviewAgeDays: policy.maximumBenchmarkReviewAgeDays });
}

/**
 * ANTI-GAMING CRÍTICO: "não declarar nada" não pode produzir PASS.
 *
 * Uma amostra em que nenhum benchmark foi efetivamente analisado tem novidade
 * zero por ausência de trabalho — e a saturação passaria trivialmente. Estes
 * dois gates tornam o PASS impossível sem análise real e sem baseline de
 * inventário declarado.
 */
function evaluateAnalysisEvidence({ sample }) {
  const violations = [];
  const benchmarks = list(sample.benchmarks);

  for (const benchmark of benchmarks) {
    if (!benchmark.analyzedAt) {
      violations.push({ benchmarkId: benchmark.id, reason: 'benchmark_not_analyzed' });
      continue;
    }
    if (!Number.isFinite(Date.parse(benchmark.analyzedAt))) {
      violations.push({ benchmarkId: benchmark.id, reason: 'benchmark_analyzed_at_invalid', value: benchmark.analyzedAt });
    }
    if (list(benchmark.sources).length === 0) {
      violations.push({ benchmarkId: benchmark.id, reason: 'benchmark_without_source' });
    }
    if (!benchmark.inventoryVersion) {
      violations.push({ benchmarkId: benchmark.id, reason: 'benchmark_without_inventory_version' });
    }
  }

  const baseline = Number(sample.canonicalInventoryBaseline);
  if (!Number.isFinite(baseline) || baseline <= 0) {
    violations.push({ reason: 'canonical_inventory_baseline_missing', value: sample.canonicalInventoryBaseline ?? null });
  }

  return status(violations.length === 0, {
    violations,
    analysedBenchmarks: benchmarks.filter((b) => b.analyzedAt).length,
    totalBenchmarks: benchmarks.length,
    canonicalInventoryBaseline: Number.isFinite(baseline) ? baseline : null,
  });
}

// ── §26/§27 Criticalidade e anti-gaming ───────────────────────────────────
/**
 * Detecta reclassificação indevida de criticalidade e capacidades não
 * classificadas. `criticalityRegistry` (opcional) é a fonte canônica herdada;
 * o sample não pode rebaixá-la.
 */
function evaluateCriticalClassification({ sample }) {
  const violations = [];
  const registry = sample.criticalityRegistry || null;

  if (registry) {
    for (const [id, declared] of Object.entries(registry)) {
      const override = list(sample.criticalityOverrides).find((o) => o.id === id);
      if (!override) continue;
      const rank = { CRITICAL: 3, REQUIRED: 2, OPTIONAL: 1, EXCLUDED: 0 };
      const from = rank[String(declared).toUpperCase()];
      const to = rank[String(override.to).toUpperCase()];
      if (Number.isFinite(from) && Number.isFinite(to) && to < from && !override.justification) {
        violations.push({ id, reason: 'criticality_downgrade_without_justification', from: declared, to: override.to });
      }
    }
  }

  const unclassifiedCriticalCapabilities = list(sample.unclassifiedCriticalCapabilities);
  const unclassifiedCriticalJourneys = list(sample.unclassifiedCriticalJourneys);
  const unclassifiedCriticalRules = list(sample.unclassifiedCriticalRules);
  if (unclassifiedCriticalCapabilities.length > 0) violations.push({ reason: 'unclassified_critical_capabilities', items: unclassifiedCriticalCapabilities });
  if (unclassifiedCriticalJourneys.length > 0) violations.push({ reason: 'unclassified_critical_journeys', items: unclassifiedCriticalJourneys });
  if (unclassifiedCriticalRules.length > 0) violations.push({ reason: 'unclassified_critical_rules', items: unclassifiedCriticalRules });

  return status(violations.length === 0, {
    violations,
    unclassifiedCriticalCapabilities: unclassifiedCriticalCapabilities.length,
    unclassifiedCriticalJourneys: unclassifiedCriticalJourneys.length,
    unclassifiedCriticalRules: unclassifiedCriticalRules.length,
  });
}

// ── §4 Fonte explícita de gates bloqueantes ───────────────────────────────
//
// BUG REPRODUZIDO (§2): a decisão final filtrava os gates por
// `policy.criticalGates`, e essa lista OMITIA `governanceFloor`. Um gate
// bloqueante fora da lista deixava de bloquear: o engine devolvia
// SAMPLE_SUFFICIENT com `governanceFloor = FAIL`.
//
// Correção estrutural: a semântica de bloqueio passa a ser DERIVADA da
// registry de gates do engine — bloqueante por padrão —, e apenas os gates
// declarados em INFORMATION_ONLY_GATES são informativos. Não é configurável
// por policy de propósito: uma policy capaz de remover um gate bloqueante da
// decisão reintroduz exatamente o bug acima (fail-open).

/**
 * Gates cujo resultado é informativo e não bloqueia certificação.
 * Qualquer gate fora desta lista é bloqueante.
 */
const INFORMATION_ONLY_GATES = Object.freeze(['benchmarkIndependence']);

/** Ordem canônica dos gates avaliados por evaluateSampleSufficiency. */
const GATE_NAMES = Object.freeze([
  'marketArchetypeCoverage',
  'benchmarkDiversity',
  'benchmarkIndependence',
  'capabilitySaturation',
  'journeySaturation',
  'businessRuleSaturation',
  'holdoutValidation',
  'sourceQuality',
  'freshness',
  'criticalClassification',
  'inventoryArithmetic',
  'orderSensitivity',
  'governanceFloor',
  'analysisEvidence',
]);

/**
 * Gates que bloqueiam certificação: todo gate da registry que não seja
 * explicitamente information-only.
 *
 * @returns {string[]}
 */
function listCriticalGates() {
  return GATE_NAMES.filter((gate) => !INFORMATION_ONLY_GATES.includes(gate));
}

// ── §40 Gate principal ────────────────────────────────────────────────────

function evaluateSampleSufficiency({ sample, policy, now = new Date() }) {
  const archetypeCoverage = evaluateArchetypeCoverage({ sample });
  const independence = evaluateIndependence({ sample });
  const diversity = evaluateDiversity({ sample, policy });
  const saturation = evaluateSaturation({ sample, policy });
  const holdout = evaluateHoldout({ sample, policy });
  const leaveOneOut = evaluateLeaveOneOut({ sample });
  const orderSensitivity = evaluateOrderSensitivity({ sample, policy });
  const sourceQuality = evaluateSourceQuality({ sample, policy });
  const freshness = evaluateFreshness({ sample, policy, now });
  const criticalClassification = evaluateCriticalClassification({ sample });
  const analysisEvidence = evaluateAnalysisEvidence({ sample });

  const inventoryArithmetic = status(saturation.curve.arithmeticViolations.length === 0, {
    violations: saturation.curve.arithmeticViolations,
    inventorySize: saturation.curve.inventorySize,
  });

  const discovery = discoveryBenchmarks(sample);
  const independentDiscoveryBenchmarks = new Set(discovery.map((b) => String(b.independenceGroup || b.id))).size;
  const independentValidationBenchmarks = new Set(validationBenchmarks(sample).map((b) => String(b.independenceGroup || b.id))).size;

  const floor = [];
  if (independentDiscoveryBenchmarks < Number(policy.minimumIndependentDiscoveryBenchmarks)) {
    floor.push({ reason: 'independent_discovery_benchmarks_below_floor', actual: independentDiscoveryBenchmarks, required: policy.minimumIndependentDiscoveryBenchmarks });
  }
  if (independentValidationBenchmarks < Number(policy.minimumIndependentValidationBenchmarks)) {
    const exception = sample.validationHoldoutUnavailable || null;
    if (!(exception && exception.scarcityEvidence && exception.approvedBy)) {
      floor.push({ reason: 'validation_holdout_unavailable_without_exception', actual: independentValidationBenchmarks });
    }
  }
  const floorGate = status(floor.length === 0, { violations: floor });

  const gates = {
    marketArchetypeCoverage: archetypeCoverage,
    benchmarkDiversity: diversity,
    benchmarkIndependence: status(true, { ...independence, informationOnly: true }),
    capabilitySaturation: saturation.capability,
    journeySaturation: saturation.journey,
    businessRuleSaturation: saturation.businessRule,
    holdoutValidation: holdout,
    sourceQuality,
    freshness,
    criticalClassification,
    inventoryArithmetic,
    orderSensitivity,
    governanceFloor: floorGate,
    analysisEvidence,
  };

  const blocking = Object.entries(gates)
    .filter(([, gate]) => gate.status !== 'PASS')
    .map(([name, gate]) => ({ gate: name, ...(gate.violations ? { violations: gate.violations } : {}), ...(gate.reason ? { reason: gate.reason } : {}) }));

  const criticalGates = listCriticalGates();
  const criticalBlocking = blocking.filter((b) => criticalGates.includes(b.gate));

  // Universidade: nenhuma contagem prova suficiência; o estado é derivado dos gates.
  let state;
  if (list(sample.benchmarks).length === 0) state = SAMPLE_STATES.NOT_RESEARCHED;
  else if (analysisEvidence.analysedBenchmarks === 0) state = SAMPLE_STATES.NOT_RESEARCHED;
  else if (String(sample.researchState || '').toUpperCase() === 'RESEARCHING') state = SAMPLE_STATES.RESEARCHING;
  else if (holdout.status === 'FAIL' && holdout.violations.some((v) => String(v.reason).startsWith('holdout_new_critical') || v.reason === 'holdout_noncritical_novelty_rate_exceeded')) state = SAMPLE_STATES.HOLDOUT_FAILED;
  else if (String(sample.revalidationRequired || '').length > 0) state = SAMPLE_STATES.REVALIDATION_REQUIRED;
  else if (criticalBlocking.length === 0) state = SAMPLE_STATES.SUFFICIENT;
  else state = SAMPLE_STATES.NOT_SATURATED;

  return {
    vertical: sample.vertical,
    sampleVersion: sample.sampleVersion,
    inventoryVersion: sample.inventoryVersion,
    policyVersion: policy.version,
    status: state,
    certifiable: state === SAMPLE_STATES.SUFFICIENT,
    gates,
    blocking,
    criticalBlocking,
    discoverySet: discovery.map((b) => b.id),
    validationSet: validationBenchmarks(sample).map((b) => b.id),
    discoveryCurve: saturation.curve.points,
    inventorySize: saturation.curve.inventorySize,
    leaveOneOut,
    externalBlock: sample.externalBlock || null,
  };
}

module.exports = {
  SAMPLE_STATES,
  EXTERNAL_BLOCK_STATE,
  NOVELTY_KEYS,
  ALL_NOVELTY_KEYS,
  INFORMATION_ONLY_GATES,
  GATE_NAMES,
  listCriticalGates,
  emptyNovelty,
  discoveryBenchmarks,
  validationBenchmarks,
  evaluateArchetypeCoverage,
  evaluateDiversity,
  evaluateIndependence,
  detectCorrelatedCloneBenchmarks,
  buildDiscoveryCurve,
  evaluateSaturation,
  evaluateHoldout,
  evaluateLeaveOneOut,
  evaluateOrderSensitivity,
  evaluateSourceQuality,
  evaluateFreshness,
  evaluateCriticalClassification,
  evaluateAnalysisEvidence,
  evaluateSampleSufficiency,
};
