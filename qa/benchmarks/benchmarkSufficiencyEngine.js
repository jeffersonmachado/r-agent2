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
  HOLDOUT_NOT_ANALYZED: 'SAMPLE_HOLDOUT_NOT_ANALYZED',
  INVALID_FINDINGS: 'SAMPLE_INVALID_FINDINGS',
  REVALIDATION_REQUIRED: 'SAMPLE_REVALIDATION_REQUIRED',
  SUFFICIENT: 'SAMPLE_SUFFICIENT',
});

/** Estado externo (não é falha do RAP, é bloqueio de pesquisa). */
const EXTERNAL_BLOCK_STATE = 'SAMPLE_CERTIFICATION_BLOCKED_BY_EXTERNAL_RESEARCH';

/**
 * Máquina de estados do holdout (adversarial, §4 do hardening final).
 *
 * Regras invariantes:
 *   NOT_REGISTERED != PRE_REGISTERED
 *   PRE_REGISTERED != ANALYZED
 *   ANALYZED       != PASS
 *   PASS somente após ANÁLISE REAL + EVIDÊNCIA DE ANÁLISE VÁLIDA + ausência de
 *   violação de política.
 *
 * O bug corrigido: sem `analyzedAt` a novidade declarada é vazia, a taxa cai a
 * 0, o 0 fica abaixo do threshold e o gate devolvia PASS por AUSÊNCIA DE
 * TRABALHO. Um holdout não analisado não é um holdout aprovado.
 */
const HOLDOUT_STATES = Object.freeze({
  NOT_REGISTERED: 'HOLDOUT_NOT_REGISTERED',
  PRE_REGISTERED: 'HOLDOUT_PRE_REGISTERED',
  NOT_ANALYZED: 'HOLDOUT_NOT_ANALYZED',
  ANALYSIS_EVIDENCE_INCOMPLETE: 'HOLDOUT_ANALYSIS_EVIDENCE_INCOMPLETE',
  NOT_MEASURABLE: 'HOLDOUT_NOT_MEASURABLE',
  FAIL: 'HOLDOUT_FAIL',
  PASS: 'HOLDOUT_PASS',
});

/**
 * Campos que PROVAM que a análise de um benchmark aconteceu de verdade.
 * `analyzedAt` sozinho é uma data digitada; sem versão de pesquisa, inventário
 * de findings, mapeamento de arquétipo e grupo de independência não há como
 * auditar o que foi (ou não) analisado.
 */
const HOLDOUT_ANALYSIS_EVIDENCE_FIELDS = Object.freeze([
  'researchVersion',
  'findingsInventory',
  'marketArchetypeMapping',
]);

/** Motivo auditável por lacuna de evidência de análise do holdout. */
const HOLDOUT_ANALYSIS_GAP_REASONS = Object.freeze({
  analyzedAt: 'holdout_not_analyzed',
  sourceEvidence: 'holdout_without_source_evidence',
  researchVersion: 'holdout_without_research_version',
  findingsInventory: 'holdout_without_findings_inventory',
  marketArchetypeMapping: 'holdout_without_market_archetype_mapping',
  independenceGroup: 'holdout_without_independence_group',
});

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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Fonte GENÉRICA é a que não aponta para nada específico: homepage/raiz do
 * host, ou declaração explícita `specificity: 'GENERIC'`. Uma homepage oficial
 * prova que o fornecedor existe — não prova 50 capabilities.
 */
function isGenericSource(source) {
  if (!source || typeof source !== 'object') return true;
  if (String(source.specificity || '').toUpperCase() === 'GENERIC') return true;
  if (!isNonEmptyString(source.url)) return true;
  try {
    const parsed = new URL(source.url);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    const hasQuery = parsed.search.length > 1;
    return pathname === '' && !hasQuery;
  } catch (_) {
    return false;
  }
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

/**
 * Grupo corporativo EFETIVO de um benchmark. Um clone/white-label herda o
 * grupo do alvo declarado: receber um `independenceGroup` próprio não o torna
 * uma observação independente (§6/§27).
 */
function buildEffectiveGroupResolver(benchmarks) {
  const groupById = new Map(benchmarks.map((b) => [b.id, String(b.independenceGroup || b.id)]));
  return (b) => {
    const parent = b.cloneOf || b.baseProduct;
    if (parent && groupById.has(String(parent))) return groupById.get(String(parent));
    return String(b.cloneOf || b.baseProduct || b.independenceGroup || b.id);
  };
}

/** Grupos corporativos distintos de uma coleção, já colapsando clones. */
function effectiveGroupsOf(benchmarks) {
  const resolve = buildEffectiveGroupResolver(benchmarks);
  return new Set(benchmarks.map((b) => resolve(b)));
}

/**
 * Benchmarks do mesmo independence_group NÃO são observações independentes.
 * `independentDiscoveryBenchmarks` colapsa clones — é a contagem usada pelo
 * floor de governança, para que white-label não infle o piso.
 */
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
  const declaredDiscoveryGroups = new Set(discovery.map((b) => String(b.independenceGroup || b.id))).size;
  const independentDiscovery = effectiveGroupsOf(discovery).size;

  return status(true, {
    independenceGroups: [...groups.keys()],
    groups: [...groups.entries()].map(([group, ids]) => ({ group, ids })),
    discoveryGroups: declaredDiscoveryGroups,
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
  const effectiveGroup = buildEffectiveGroupResolver(benchmarks);

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
    // §6 Número de observações REALMENTE independentes: white-label, produto
    // irmão e fornecedor convergido não contam duas vezes.
    independentSources: discoverySources.size,
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

  // §6 `minimumDistinctIndependenceGroups` era campo normativo sem consumidor.
  // Escopo: grupos corporativos distintos da AMOSTRA INTEIRA (discovery +
  // validação), já colapsando clones/white-labels. É deliberadamente uma
  // métrica diferente do floor `minimumIndependentDiscoveryBenchmarks`, que
  // mede observações independentes apenas em discovery.
  const minimumIndependentGroups = Number(policy.minimumDistinctIndependenceGroups);
  const sampleGroups = effectiveGroupsOf(benchmarks);
  if (Number.isFinite(minimumIndependentGroups) && sampleGroups.size < minimumIndependentGroups) {
    concentrationBreakdown.push({
      reason: 'independent_groups_below_minimum',
      distinct: sampleGroups.size,
      required: minimumIndependentGroups,
      declared: new Set(benchmarks.map((b) => String(b.independenceGroup || b.id))).size,
    });
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

// ── §8–§13 Curvas de inventário por dimensão ──────────────────────────────

const BASELINE_STATES = Object.freeze({ DECLARED: 'DECLARED', UNKNOWN: 'UNKNOWN' });
const PREVIOUS_SIZE_STATES = Object.freeze({ DECLARED: 'DECLARED', FROM_CURVE: 'FROM_CURVE' });
const RATE_STATES = Object.freeze({
  MEASURED: 'MEASURED',
  NOT_MEASURABLE_ZERO_DENOMINATOR: 'NOT_MEASURABLE_ZERO_DENOMINATOR',
  BASELINE_UNKNOWN: 'BASELINE_UNKNOWN',
  /**
   * O benchmark NÃO foi pesquisado: existe apenas fonte/declaração, sem
   * análise. Um ponto não analisado nunca é `MEASURED` — `0` de novidade só
   * pode significar "pesquisei e nada era novo", jamais "não pesquisei".
   */
  NOT_ANALYZED: 'NOT_ANALYZED',
});

/**
 * `benchmarkAnalysisEvidenceGaps` — o que PROVA que a análise de um benchmark de
 * descoberta aconteceu. Mesma disciplina do holdout (§5): `analyzedAt` sozinho é
 * uma data digitada; sem `researchVersion` e `findingsInventory` não há como
 * auditar o que foi lido. Retorna os campos AUSENTES (auditável campo a campo),
 * nunca booleano solto.
 */
function benchmarkAnalysisEvidenceGaps(benchmark) {
  const missing = [];
  if (!benchmark || typeof benchmark !== 'object') return ['benchmark'];
  if (!isNonEmptyString(benchmark.analyzedAt) || !Number.isFinite(Date.parse(benchmark.analyzedAt))) {
    missing.push('analyzedAt');
  }
  if (!isNonEmptyString(benchmark.researchVersion)) missing.push('researchVersion');
  if (!Array.isArray(benchmark.findingsInventory)) missing.push('findingsInventory');
  if (list(benchmark.sources).length === 0) missing.push('sourceEvidence');
  return missing;
}

/**
 * §8/§9/§10 Cada dimensão tem baseline PRÓPRIO e denominador PRÓPRIO. Medir a
 * novidade de jornadas sobre o inventário de capabilities (ou vice-versa)
 * mascara novidade real por diluição.
 */
const INVENTORY_DIMENSIONS = Object.freeze({
  capabilities: Object.freeze({
    gate: 'capability',
    baselineField: 'canonicalInventoryBaseline',
    previousField: 'previousInventorySize',
    newField: NOVELTY_KEYS.capabilities,
    requiredField: NOVELTY_KEYS.requiredCapabilities,
    criticalField: NOVELTY_KEYS.criticalCapabilities,
    ratePolicyField: 'maxNoncriticalCapabilityNoveltyRate',
    absolutePolicyField: 'maxNewCriticalRequiredCapabilitiesInWindow',
  }),
  journeys: Object.freeze({
    gate: 'journey',
    baselineField: 'canonicalJourneyInventoryBaseline',
    previousField: 'previousJourneyInventorySize',
    newField: NOVELTY_KEYS.journeys,
    requiredField: NOVELTY_KEYS.requiredJourneys,
    criticalField: NOVELTY_KEYS.criticalJourneys,
    ratePolicyField: 'maxNoncriticalJourneyNoveltyRate',
    absolutePolicyField: 'maxNewCriticalRequiredJourneysInWindow',
  }),
  businessRules: Object.freeze({
    gate: 'businessRule',
    baselineField: 'canonicalBusinessRuleInventoryBaseline',
    previousField: 'previousBusinessRuleInventorySize',
    newField: NOVELTY_KEYS.businessRules,
    requiredField: NOVELTY_KEYS.requiredBusinessRules,
    criticalField: NOVELTY_KEYS.criticalBusinessRules,
    ratePolicyField: 'maxNoncriticalBusinessRuleNoveltyRate',
    absolutePolicyField: 'maxNewCriticalRequiredBusinessRulesInWindow',
  }),
});
const INVENTORY_DIMENSION_NAMES = Object.freeze(Object.keys(INVENTORY_DIMENSIONS));

/**
 * §11 Lê um número DECLARADO distinguindo ausência de zero. `null`, `undefined`
 * e `''` são UNKNOWN — jamais 0. (`Number(null)` é 0: era exatamente aí que
 * nasciam as taxas artificiais.)
 */
function declaredNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * §12 Curva de inventário de UMA dimensão, começando no baseline canônico
 * declarado (não em 0). Um `previousInventorySize` declarado é conferido contra
 * a soma acumulada — impede "remover item do denominador" e recálculo
 * silencioso do histórico. When the baseline is UNKNOWN the arithmetic is
 * declared unverifiable instead of being compared against an invented 0.
 */
function buildInventoryCurve({ sample, dimension = 'capabilities', benchmarks = null, baselineOverride = undefined }) {
  const spec = INVENTORY_DIMENSIONS[dimension];
  if (!spec) throw new TypeError(`unknown_inventory_dimension:${dimension}`);

  const ordered = benchmarks ? list(benchmarks) : discoveryBenchmarks(sample);
  // §13 O estágio de validação parte do inventário AO FIM do discovery; o
  // discovery parte do baseline canônico. `baselineOverride` permite encadear
  // os estágios sem recalcular o histórico.
  const baseline = baselineOverride === undefined ? declaredNumber(sample[spec.baselineField]) : baselineOverride;
  const baselineState = baseline === null ? BASELINE_STATES.UNKNOWN : BASELINE_STATES.DECLARED;
  const points = [];
  const arithmeticViolations = [];
  let cumulative = baseline;

  for (const benchmark of ordered) {
    const novelty = benchmark.novelty || emptyNovelty();
    const newItems = list(novelty[spec.newField]);
    const newRequiredItems = list(novelty[spec.requiredField]);
    const newCriticalItems = list(novelty[spec.criticalField]);
    const declared = declaredNumber(benchmark[spec.previousField]);
    // Sem baseline declarado não existe "esperado": a aritmética é inverificável.
    const expected = baselineState === BASELINE_STATES.DECLARED ? cumulative : null;

    if (declared !== null && expected !== null && declared !== expected) {
      arithmeticViolations.push({ benchmarkId: benchmark.id, declared, expectedFromCurve: expected });
    }

    const previousInventorySize = declared !== null ? declared : expected;
    // §B1..B3: mensurabilidade exige PESQUISA, não apenas denominador. Sem
    // evidência de análise o ponto é NOT_ANALYZED (novidade nula) — assim a
    // janela de saturação não pode ser completada com trabalho inexistente.
    const analysisGaps = benchmarkAnalysisEvidenceGaps(benchmark);
    let noveltyRate;
    let rateState;
    if (analysisGaps.length > 0) {
      noveltyRate = null;
      rateState = RATE_STATES.NOT_ANALYZED;
    } else if (previousInventorySize === null) {
      noveltyRate = null;
      rateState = RATE_STATES.BASELINE_UNKNOWN;
    } else if (previousInventorySize > 0) {
      noveltyRate = round6(newItems.length / previousInventorySize);
      rateState = RATE_STATES.MEASURED;
    } else {
      noveltyRate = null;
      rateState = RATE_STATES.NOT_MEASURABLE_ZERO_DENOMINATOR;
    }

    const cumulativeInventorySize = (cumulative === null ? 0 : cumulative) + newItems.length;
    points.push({
      benchmarkId: benchmark.id,
      order: Number(benchmark.order),
      independenceGroup: String(benchmark.independenceGroup || benchmark.id),
      archetype: benchmark.archetype || null,
      previousInventorySize,
      previousInventorySizeState: declared !== null ? PREVIOUS_SIZE_STATES.DECLARED : PREVIOUS_SIZE_STATES.FROM_CURVE,
      declaredPreviousInventorySize: declared,
      newItems: newItems.length,
      newRequiredItems: newRequiredItems.length,
      newCriticalItems: newCriticalItems.length,
      noveltyRate,
      rateState,
      analysisGaps,
      cumulativeInventorySize,
    });
    cumulative = cumulativeInventorySize;
  }

  return {
    dimension,
    gate: spec.gate,
    baseline,
    baselineState,
    baselineField: spec.baselineField,
    previousField: spec.previousField,
    points,
    inventorySize: baselineState === BASELINE_STATES.DECLARED ? cumulative : null,
    arithmeticViolations,
  };
}

/**
 * View de compatibilidade: curva de capabilities com os nomes de campo usados
 * pelos relatórios existentes, mais os campos genéricos por dimensão.
 */
function buildDiscoveryCurve({ sample }) {
  const curve = buildInventoryCurve({ sample, dimension: 'capabilities' });
  const ordered = discoveryBenchmarks(sample);
  const points = curve.points.map((point, index) => {
    const novelty = (ordered[index] && ordered[index].novelty) || emptyNovelty();
    return {
      ...point,
      newCapabilities: point.newItems,
      newRequiredCapabilities: point.newRequiredItems,
      newCriticalCapabilities: point.newCriticalItems,
      newJourneys: list(novelty[NOVELTY_KEYS.journeys]).length,
      newRequiredJourneys: list(novelty[NOVELTY_KEYS.requiredJourneys]).length,
      newCriticalJourneys: list(novelty[NOVELTY_KEYS.criticalJourneys]).length,
      newBusinessRules: list(novelty[NOVELTY_KEYS.businessRules]).length,
      newRequiredBusinessRules: list(novelty[NOVELTY_KEYS.requiredBusinessRules]).length,
      newCriticalBusinessRules: list(novelty[NOVELTY_KEYS.criticalBusinessRules]).length,
    };
  });
  return { ...curve, points };
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
  const windowSize = Math.max(1, Number(policy.saturationWindow) || 1);
  const curves = Object.fromEntries(
    INVENTORY_DIMENSION_NAMES.map((dimension) => [dimension, buildInventoryCurve({ sample, dimension })]),
  );

  /**
   * §9/§10/§11 Gate de UMA dimensão. A taxa de novidade só é comparável em
   * pontos MENSURÁVEIS: denominador zero ou baseline desconhecido produzem
   * `NOT_MEASURABLE` — nunca PASS silencioso, nunca 0/1 artificial.
   */
  const dimensionGate = (dimension) => {
    const spec = INVENTORY_DIMENSIONS[dimension];
    const curve = curves[dimension];
    const window = saturationWindowPoints(curve, policy);
    const insufficientWindow = window.length < windowSize;
    const maxAbsolute = Number(policy[spec.absolutePolicyField]);
    const maxRate = Number(policy[spec.ratePolicyField]);
    const violations = [];

    if (insufficientWindow) {
      violations.push({ reason: `${spec.gate}_saturation_window_insufficient`, windowSize: window.length, required: windowSize });
    }
    for (const point of window) {
      if (point.newCriticalItems > maxAbsolute) {
        violations.push({ benchmarkId: point.benchmarkId, reason: `${spec.gate}_new_critical_items_exceeded`, value: point.newCriticalItems, threshold: maxAbsolute });
      }
      if (point.newRequiredItems > maxAbsolute) {
        violations.push({ benchmarkId: point.benchmarkId, reason: `${spec.gate}_new_required_items_exceeded`, value: point.newRequiredItems, threshold: maxAbsolute });
      }
    }

    const measurable = window.filter((point) => point.rateState === RATE_STATES.MEASURED);
    const unmeasurable = window.filter((point) => point.rateState !== RATE_STATES.MEASURED);
    const rateState = window.length === 0
      ? 'NO_WINDOW'
      : (measurable.length === 0
        ? unmeasurable[0].rateState
        : (unmeasurable.length > 0 ? 'PARTIALLY_UNMEASURABLE' : RATE_STATES.MEASURED));

    for (const point of measurable) {
      if (point.noveltyRate > maxRate) {
        violations.push({ benchmarkId: point.benchmarkId, reason: `${spec.gate}_novelty_rate_exceeded`, rate: point.noveltyRate, threshold: maxRate });
      }
    }

    const measuredRateFailed = violations.some((v) => String(v.reason).endsWith('_novelty_rate_exceeded'));
    const absoluteFailed = violations.some((v) => !String(v.reason).endsWith('_novelty_rate_exceeded'));
    // §B4: a janela de saturação só é mensurável se TODOS os pontos reais o
    // forem. Completar a janela com benchmark não pesquisado (ou parcialmente
    // pesquisado) é PASS por ausência de trabalho — proibido.
    const notMeasurable = window.length > 0 && measurable.length < window.length;
    if (notMeasurable) {
      const unanalyzed = unmeasurable.filter((point) => point.rateState === RATE_STATES.NOT_ANALYZED);
      violations.push({
        reason: unanalyzed.length > 0
          ? `${spec.gate}_saturation_window_not_researched`
          : `${spec.gate}_novelty_rate_baseline_unknown`,
        rateState,
        baselineField: curve.baselineField,
        benchmarks: unmeasurable.map((point) => point.benchmarkId),
        ...(unanalyzed.length > 0
          ? { unanalyzedBenchmarks: unanalyzed.map((point) => ({ benchmarkId: point.benchmarkId, missingEvidence: point.analysisGaps })) }
          : {}),
      });
    }

    let gateStatus = 'PASS';
    if (measuredRateFailed || absoluteFailed) gateStatus = 'FAIL';
    else if (notMeasurable) gateStatus = 'NOT_MEASURABLE';

    return {
      status: gateStatus,
      dimension,
      window: window.map((point) => point.benchmarkId),
      windowPoints: window,
      windowSize: window.length,
      insufficientWindow,
      rateState,
      baselineState: curve.baselineState,
      baseline: curve.baseline,
      thresholds: { maxNoncriticalNoveltyRate: maxRate, maxNewCriticalRequired: maxAbsolute },
      violations,
    };
  };

  const capability = dimensionGate('capabilities');
  const journey = dimensionGate('journeys');
  const businessRule = dimensionGate('businessRules');

  return {
    curves,
    curve: curves.capabilities,
    // Contrato histórico: `window` são os PONTOS da janela de capabilities.
    window: capability.windowPoints,
    capability,
    journey,
    businessRule,
  };
}

// ── §14/§15/§16 Holdout ───────────────────────────────────────────────────

/**
 * Evidência de análise do holdout (§5): o que PROVA que a pesquisa aconteceu.
 * Retorna a lista de campos obrigatórios ausentes — nunca booleano solto, para
 * que a violação seja auditável campo a campo.
 */
function holdoutAnalysisEvidenceGaps(benchmark) {
  const missing = [];
  if (!benchmark || typeof benchmark !== 'object') return ['benchmark'];
  if (!isNonEmptyString(benchmark.analyzedAt) || !Number.isFinite(Date.parse(benchmark.analyzedAt))) {
    missing.push('analyzedAt');
  }
  if (list(benchmark.sources).length === 0) missing.push('sourceEvidence');
  if (!isNonEmptyString(benchmark.researchVersion)) missing.push('researchVersion');
  if (!Array.isArray(benchmark.findingsInventory)) missing.push('findingsInventory');
  if (!benchmark.marketArchetypeMapping && !isNonEmptyString(benchmark.archetype)) missing.push('marketArchetypeMapping');
  if (!isNonEmptyString(benchmark.independenceGroup) && !isNonEmptyString(benchmark.cloneOf) && !isNonEmptyString(benchmark.baseProduct)) {
    missing.push('independenceGroup');
  }
  return missing;
}

/**
 * Valida o holdout pré-registrado. Falhas absolutas:
 * - novelty crítico REQUIRED em capability/jornada/regra de negócio;
 * - ausência de pré-registro;
 * - NÃO ANÁLISE (um holdout não pesquisado jamais é PASS, §3);
 * - evidência de análise incompleta (§5);
 * - leakage (holdout analisado antes de ser reservado, ou usado como discovery).
 *
 * Todo retorno carrega `holdoutState` da taxonomia HOLDOUT_STATES: o consumidor
 * nunca precisa inferir o estado a partir de `status`.
 */
function evaluateHoldout({ sample, policy }) {
  const holdoutRecord = sample.holdout || null;
  const validation = validationBenchmarks(sample);
  const violations = [];
  const preregistrationFields = ['benchmarkId', 'selectedAsHoldoutAt', 'selectionReason', 'selectionEvidence', 'marketArchetype', 'inventoryVersion'];

  const fail = (state, detail, extra = {}) => ({
    status: 'FAIL',
    holdoutState: state,
    ...detail,
    ...extra,
  });

  if (!holdoutRecord) {
    return fail(HOLDOUT_STATES.NOT_REGISTERED, {
      holdoutId: null,
      violations: [{ reason: 'holdout_not_preregistered' }],
      requiredPreregistrationFields: preregistrationFields,
    });
  }

  for (const field of preregistrationFields) {
    if (!holdoutRecord[field]) violations.push({ reason: 'holdout_preregistration_incomplete', field });
  }

  const benchmark = validation.find((b) => b.id === holdoutRecord.benchmarkId) || null;
  if (!benchmark) {
    violations.push({ reason: 'holdout_benchmark_not_found', benchmarkId: holdoutRecord.benchmarkId });
    return fail(HOLDOUT_STATES.NOT_REGISTERED, { holdoutId: holdoutRecord.benchmarkId, violations });
  }

  // Anti-leakage temporal: o holdout não pode ter sido analisado antes de ser reservado.
  const selectedAt = Date.parse(holdoutRecord.selectedAsHoldoutAt);
  // Fonte de verdade da análise é o BENCHMARK (é ele que é analisado). O campo
  // homônimo no registro de holdout só serve de fallback: ler apenas o registro
  // deixava a regra de "mesmo instante" inalcançável na prática.
  const analyzedAtValue = benchmark.analyzedAt || holdoutRecord.analyzedAt || null;
  const analyzedAt = analyzedAtValue ? Date.parse(analyzedAtValue) : null;
  if (Number.isFinite(selectedAt) && Number.isFinite(analyzedAt) && analyzedAt < selectedAt) {
    violations.push({
      reason: 'holdout_leakage_analyzed_before_preregistration',
      selectedAsHoldoutAt: holdoutRecord.selectedAsHoldoutAt,
      analyzedAt: analyzedAtValue,
    });
  }
  if (analyzedAtValue && holdoutRecord.selectedAsHoldoutAt
    && Date.parse(holdoutRecord.selectedAsHoldoutAt) === Date.parse(analyzedAtValue)) {
    violations.push({ reason: 'holdout_preregistration_same_instant_as_analysis' });
  }

  // §3/§4/§5 O holdout está PRE_REGISTERED. Sem análise real, o estado é
  // NOT_ANALYZED e o gate NÃO pode ser PASS — independentemente de a novidade
  // declarada (vazia) resultar em taxa 0 dentro do threshold. É exatamente esse
  // falso verde que este bloco elimina.
  const analysisGaps = holdoutAnalysisEvidenceGaps(benchmark);
  const preRegisteredDetail = {
    holdoutId: benchmark.id,
    marketArchetype: holdoutRecord.marketArchetype,
    preRegisteredAt: holdoutRecord.selectedAsHoldoutAt,
    analyzedAt: isNonEmptyString(benchmark.analyzedAt) ? benchmark.analyzedAt : null,
    inventoryVersion: holdoutRecord.inventoryVersion,
    missingAnalysisEvidence: analysisGaps,
    violations,
  };

  if (!isNonEmptyString(benchmark.analyzedAt)) {
    return {
      status: HOLDOUT_STATES.NOT_ANALYZED,
      holdoutState: HOLDOUT_STATES.NOT_ANALYZED,
      ...preRegisteredDetail,
      rateState: RATE_STATES.BASELINE_UNKNOWN,
      noncriticalNoveltyRate: null,
      violations: [...violations, { reason: 'holdout_not_analyzed', benchmarkId: benchmark.id }],
    };
  }

  if (!Number.isFinite(Date.parse(benchmark.analyzedAt))) {
    return {
      status: 'FAIL',
      holdoutState: HOLDOUT_STATES.NOT_ANALYZED,
      ...preRegisteredDetail,
      violations: [
        ...violations,
        { reason: 'holdout_analyzed_at_invalid', value: benchmark.analyzedAt },
      ],
    };
  }

  // Análise declarada, mas sem evidência auditável de análise: NÃO é PASS e não
  // é FAIL de política — é NÃO MENSURÁVEL (falta o insumo, não o resultado).
  if (analysisGaps.length > 0) {
    return {
      status: 'NOT_MEASURABLE',
      holdoutState: HOLDOUT_STATES.ANALYSIS_EVIDENCE_INCOMPLETE,
      ...preRegisteredDetail,
      violations: [
        ...violations,
        { reason: 'holdout_analysis_evidence_incomplete', missing: analysisGaps },
        ...analysisGaps.map((gap) => ({ reason: HOLDOUT_ANALYSIS_GAP_REASONS[gap] || 'holdout_analysis_evidence_field_missing', field: gap })),
      ],
    };
  }

  const novelty = benchmark.novelty || emptyNovelty();
  const newCriticalCapabilities = list(novelty[NOVELTY_KEYS.criticalCapabilities]);
  const newCriticalRequiredCapabilities = newCriticalCapabilities.filter((c) => c.required !== false);
  const newCriticalJourneys = list(novelty[NOVELTY_KEYS.criticalJourneys]);
  const newCriticalBusinessRules = list(novelty[NOVELTY_KEYS.criticalBusinessRules]);
  const newCapabilities = list(novelty[NOVELTY_KEYS.capabilities]);

  // §13 Curvas próprias do estágio de validação: o holdout parte do inventário
  // consolidado ao fim do discovery (baseline canônico + contribuições), uma
  // curva por dimensão.
  const holdoutCurves = Object.fromEntries(
    INVENTORY_DIMENSION_NAMES.map((dimension) => [
      dimension,
      buildInventoryCurve({
        sample,
        dimension,
        benchmarks: validation,
        baselineOverride: buildInventoryCurve({ sample, dimension }).inventorySize,
      }),
    ]),
  );
  const holdoutPoint = holdoutCurves.capabilities.points.find((point) => point.benchmarkId === benchmark.id) || null;
  // §11 Sem denominador confiável NÃO existe taxa: o código anterior fazia
  // `Number(previousInventorySize) || 0` (null → 0) e, com novidade presente,
  // devolvia 1 — um "100% de novidade" fabricado.
  const noncriticalRate = holdoutPoint ? holdoutPoint.noveltyRate : null;
  const rateState = holdoutPoint ? holdoutPoint.rateState : RATE_STATES.BASELINE_UNKNOWN;

  if (newCriticalRequiredCapabilities.length > Number(policy.maxHoldoutNewCriticalRequiredCapabilities)) {
    violations.push({ reason: 'holdout_new_critical_required_capabilities', items: newCriticalRequiredCapabilities });
  }
  if (newCriticalJourneys.length > Number(policy.maxHoldoutNewCriticalRequiredJourneys)) {
    violations.push({ reason: 'holdout_new_critical_journeys', items: newCriticalJourneys });
  }
  if (newCriticalBusinessRules.length > Number(policy.maxHoldoutNewCriticalRequiredBusinessRules)) {
    violations.push({ reason: 'holdout_new_critical_business_rules', items: newCriticalBusinessRules });
  }
  if (rateState === RATE_STATES.MEASURED && noncriticalRate > Number(policy.maxHoldoutNoncriticalNoveltyRate)) {
    violations.push({ reason: 'holdout_noncritical_novelty_rate_exceeded', rate: noncriticalRate, threshold: policy.maxHoldoutNoncriticalNoveltyRate });
  }

  const detail = {
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
    rateState,
    holdoutCurves,
    violations,
  };

  if (violations.length > 0) return { ...status(false, detail), holdoutState: HOLDOUT_STATES.FAIL, holdoutCurves };
  if (rateState !== RATE_STATES.MEASURED) {
    // Declarado, não silenciado: taxa de novidade do holdout não é mensurável.
    return {
      ...detail,
      status: 'NOT_MEASURABLE',
      holdoutState: HOLDOUT_STATES.NOT_MEASURABLE,
      rateReason: `holdout_novelty_rate_${String(rateState).toLowerCase()}`,
    };
  }
  return { ...status(true, detail), holdoutState: HOLDOUT_STATES.PASS, holdoutCurves };
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

/**
 * §15 Estado DERIVADO de verificação da fonte. Não é um booleano solto: a
 * combinação tier + confirmação + URL determina se a fonte é prova oficial,
 * apoio secundário, pendência de verificação ou não prova. Os limites entre
 * oficial e secundário vêm da POLICY (thresholds não são constante de código).
 */
const SOURCE_VERIFICATION_STATES = Object.freeze({
  VERIFIED_OFFICIAL: 'VERIFIED_OFFICIAL',
  VERIFIED_SECONDARY: 'VERIFIED_SECONDARY',
  NEEDS_VERIFICATION: 'NEEDS_VERIFICATION',
  UNVERIFIED: 'UNVERIFIED',
});

/** Ordem de força (menor = mais forte) para reduzir o estado do benchmark. */
const SOURCE_VERIFICATION_ORDER = Object.freeze([
  SOURCE_VERIFICATION_STATES.VERIFIED_OFFICIAL,
  SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY,
  SOURCE_VERIFICATION_STATES.NEEDS_VERIFICATION,
  SOURCE_VERIFICATION_STATES.UNVERIFIED,
]);

function classifySourceVerification(source, policy = {}) {
  const officialMax = declaredNumber(policy.officialSourceTierMax);
  const secondaryMax = declaredNumber(policy.secondarySourceTierMax);
  const tier = declaredNumber(source && source.tier);
  const hasUrl = Boolean(source && typeof source.url === 'string' && source.url.trim().length > 0);
  const httpStatus = declaredNumber(source && source.httpStatus);

  if (!hasUrl) return SOURCE_VERIFICATION_STATES.UNVERIFIED;
  // Existe URL mas a obtenção não foi confirmada (ou veio 4xx/5xx): pendência.
  if (source.verified !== true) return SOURCE_VERIFICATION_STATES.NEEDS_VERIFICATION;
  if (httpStatus !== null && httpStatus >= 400) return SOURCE_VERIFICATION_STATES.NEEDS_VERIFICATION;
  if (tier !== null && officialMax !== null && tier <= officialMax) return SOURCE_VERIFICATION_STATES.VERIFIED_OFFICIAL;
  if (tier !== null && secondaryMax !== null && tier <= secondaryMax) return SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY;
  return SOURCE_VERIFICATION_STATES.UNVERIFIED;
}

function evaluateSourceQuality({ sample, policy }) {
  const violations = [];
  const minTier = Number(policy.minimumAcceptedSourceTier) || 5;
  const benchmarks = [];

  for (const benchmark of list(sample.benchmarks)) {
    const sources = list(benchmark.sources);
    const verification = sources.map((source) => ({
      id: source.id || source.url || null,
      tier: declaredNumber(source.tier),
      state: classifySourceVerification(source, policy),
    }));
    const hasOfficial = verification.some((entry) => entry.state === SOURCE_VERIFICATION_STATES.VERIFIED_OFFICIAL);
    const bestState = verification.reduce(
      (best, entry) => (SOURCE_VERIFICATION_ORDER.indexOf(entry.state) < SOURCE_VERIFICATION_ORDER.indexOf(best) ? entry.state : best),
      SOURCE_VERIFICATION_STATES.UNVERIFIED,
    );
    benchmarks.push({ benchmarkId: benchmark.id, verificationState: bestState, sources: verification });

    if (sources.length === 0) {
      violations.push({ benchmarkId: benchmark.id, reason: 'benchmark_without_source' });
      continue;
    }
    // §15/§16 A fonte precisa ser OFICIAL e VERIFICADA: tier aceitável sem
    // confirmação de existência/conteúdo não prova capacidade.
    if (!hasOfficial) {
      violations.push({
        benchmarkId: benchmark.id,
        reason: 'benchmark_without_verified_official_source',
        verificationState: bestState,
      });
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
    if (criticalItems.length > 0 && !hasOfficial) {
      violations.push({
        benchmarkId: benchmark.id,
        reason: 'critical_finding_source_not_verified_official',
        verificationState: bestState,
        items: criticalItems,
      });
    }
  }
  return status(violations.length === 0, { violations, benchmarks, minimumAcceptedSourceTier: minTier });
}

/**
 * §14 Rastreabilidade: descoberta CRÍTICA não é aceita como afirmação solta. A
 * cadeia precisa existir e RESOLVER: Benchmark → item → SourceRef (fonte
 * declarada) → EvidenceRef (evidência declarada). Itens não críticos não
 * exigem a cadeia porque já são limitados por threshold de saturação; exigir
 * cadeia completa de todo item criaria pressão para inflar evidência.
 */
function evaluateEvidenceTraceability({ sample }) {
  const violations = [];
  const evidence = list(sample.evidence);
  const evidenceIds = new Set(evidence.map((entry) => String(entry.id)));
  const criticalItems = [];

  for (const benchmark of list(sample.benchmarks)) {
    const novelty = benchmark.novelty || emptyNovelty();
    const sourceRefs = new Set();
    for (const [index, source] of list(benchmark.sources).entries()) {
      if (source.id) sourceRefs.add(String(source.id));
      if (source.url) sourceRefs.add(String(source.url));
      sourceRefs.add(`#${index}`);
    }

    const entries = [
      ...list(novelty[NOVELTY_KEYS.criticalCapabilities]).map((item) => ({ kind: 'capability', item })),
      ...list(novelty[NOVELTY_KEYS.criticalJourneys]).map((item) => ({ kind: 'journey', item })),
      ...list(novelty[NOVELTY_KEYS.criticalBusinessRules]).map((item) => ({ kind: 'rule', item })),
    ];

    for (const { kind, item } of entries) {
      const structured = item !== null && typeof item === 'object';
      const id = structured && item.id ? String(item.id) : String(item);
      const sourceRef = structured && item.sourceRef ? String(item.sourceRef) : null;
      const evidenceRef = structured && item.evidenceRef ? String(item.evidenceRef) : null;
      const row = { benchmarkId: benchmark.id, kind, id, sourceRef, evidenceRef };
      criticalItems.push(row);

      if (!sourceRef) violations.push({ ...row, reason: 'critical_item_without_source_ref' });
      else if (!sourceRefs.has(sourceRef)) violations.push({ ...row, reason: 'critical_item_source_ref_unresolved' });

      if (!evidenceRef) violations.push({ ...row, reason: 'critical_item_without_evidence_ref' });
      else if (!evidenceIds.has(evidenceRef)) violations.push({ ...row, reason: 'critical_item_evidence_ref_unresolved' });
    }
  }

  return status(violations.length === 0, {
    criticalItems,
    declaredEvidence: [...evidenceIds],
    violations,
  });
}

// ── §6/§7/§8/§9/§11 Evidence obrigatória para TODA descoberta ─────────────
//
// GAP: a cadeia Benchmark → Finding → Canonical Item → SourceRef → EvidenceRef
// era exigida apenas de itens CRÍTICOS. Uma capability NÃO crítica sem evidence
// também altera o inventário — portanto altera denominador, tamanho do
// inventário, novelty rate e saturação. O caminho não crítico era uma porta
// aberta para manipular o resultado final sem precisar mentir sobre nada
// crítico. Aqui a exigência passa a valer para toda descoberta.

/** Dimensão canônica de cada bucket de novelty. */
const FINDING_KIND_BY_NOVELTY_KEY = Object.freeze({
  newCapabilities: 'capability',
  newRequiredCapabilities: 'capability',
  newCriticalCapabilities: 'capability',
  newJourneys: 'journey',
  newRequiredJourneys: 'journey',
  newCriticalJourneys: 'journey',
  newBusinessRules: 'rule',
  newRequiredBusinessRules: 'rule',
  newCriticalBusinessRules: 'rule',
});

/** Criticalidade implícita do bucket, quando o item não declara a sua. */
const FINDING_CRITICALITY_BY_NOVELTY_KEY = Object.freeze({
  newCapabilities: 'UNCLASSIFIED',
  newRequiredCapabilities: 'REQUIRED',
  newCriticalCapabilities: 'CRITICAL',
  newJourneys: 'UNCLASSIFIED',
  newRequiredJourneys: 'REQUIRED',
  newCriticalJourneys: 'CRITICAL',
  newBusinessRules: 'UNCLASSIFIED',
  newRequiredBusinessRules: 'REQUIRED',
  newCriticalBusinessRules: 'CRITICAL',
});

const RAP_DERIVED_ORIGINS = Object.freeze(['RAP_DERIVED', 'RAP-DERIVED', 'DERIVED']);

function isRapDerived(item) {
  if (!item || typeof item !== 'object') return false;
  return RAP_DERIVED_ORIGINS.includes(String(item.origin || item.derivation || '').toUpperCase());
}

/**
 * Rastreabilidade OBRIGATÓRIA de toda descoberta externa + registro explícito
 * de derivações do próprio RAP (§8): o RAP pode inferir uma jornada/regra que
 * nenhum concorrente descreve literalmente, mas então precisa declarar de onde
 * derivou, com rationale, responsável e versão do inventário — jamais fingir
 * que o fornecedor publicou aquilo.
 */
function evaluateFindingEvidence({ sample, policy = {}, derivations = null }) {
  const violations = [];
  const evidence = list(sample.evidence);
  const evidenceIds = new Set(evidence.map((entry) => String(entry.id)));
  const declaredCapabilityIds = new Set();
  for (const benchmark of list(sample.benchmarks)) {
    const novelty = benchmark.novelty || emptyNovelty();
    for (const item of list(novelty[NOVELTY_KEYS.capabilities])) {
      declaredCapabilityIds.add(String(item !== null && typeof item === 'object' && item.id ? item.id : item));
    }
  }

  const derivedRecords = list(derivations === null ? sample.rapDerivations : derivations);
  const derivedFindings = [];
  const invalidDerivations = [];
  for (const record of derivedRecords) {
    const id = record && record.id ? String(record.id) : null;
    const row = { id, kind: record && record.kind ? String(record.kind) : null, origin: 'RAP_DERIVED' };
    const gaps = [];
    if (!id) gaps.push('id');
    if (!Array.isArray(record && record.derivedFrom) || list(record && record.derivedFrom).length === 0) gaps.push('derivedFrom');
    if (!isNonEmptyString(record && record.rationale)) gaps.push('rationale');
    if (!isNonEmptyString(record && record.classifiedBy)) gaps.push('classifiedBy');
    if (!isNonEmptyString(record && record.inventoryVersion)) gaps.push('inventoryVersion');
    if (gaps.length > 0) {
      violations.push({ ...row, reason: 'rap_derived_without_derivation_provenance', missing: gaps });
      invalidDerivations.push(id);
      continue;
    }
    const unresolved = list(record.derivedFrom).filter((ref) => (
      !evidenceIds.has(String(ref)) && !declaredCapabilityIds.has(String(ref))
    ));
    if (unresolved.length > 0) {
      violations.push({ ...row, reason: 'rap_derived_source_unresolved', unresolved });
      invalidDerivations.push(id);
      continue;
    }
    derivedFindings.push({ ...row, derivedFrom: list(record.derivedFrom).map(String), rationale: record.rationale, classifiedBy: record.classifiedBy });
  }

  const validFindings = [];
  const invalidFindings = [];
  let total = 0;

  for (const benchmark of list(sample.benchmarks)) {
    const novelty = benchmark.novelty || emptyNovelty();
    const sources = list(benchmark.sources);
    const sourceByRef = new Map();
    for (const [index, source] of sources.entries()) {
      if (source && source.id) sourceByRef.set(String(source.id), source);
      if (source && source.url) sourceByRef.set(String(source.url), source);
      sourceByRef.set(`#${index}`, source);
    }

    for (const key of ALL_NOVELTY_KEYS) {
      const kind = FINDING_KIND_BY_NOVELTY_KEY[key];
      for (const item of list(novelty[key])) {
        total += 1;
        const structured = item !== null && typeof item === 'object';
        const id = structured && item.id ? String(item.id) : String(item);
        const criticality = String(
          (structured && (item.criticality || item.importance)) || FINDING_CRITICALITY_BY_NOVELTY_KEY[key],
        ).toUpperCase();
        const row = { benchmarkId: benchmark.id, kind, id, criticality, noveltyKey: key };

        if (isRapDerived(item)) {
          const record = derivedFindings.find((entry) => entry.id === id);
          if (!record) {
            const violation = { ...row, reason: 'rap_derived_without_derivation_provenance', origin: 'RAP_DERIVED' };
            violations.push(violation);
            invalidFindings.push({ ...row, origin: 'RAP_DERIVED' });
            continue;
          }
          validFindings.push({ ...row, origin: 'RAP_DERIVED' });
          continue;
        }

        const sourceRef = structured && item.sourceRef ? String(item.sourceRef) : null;
        const evidenceRef = structured && item.evidenceRef ? String(item.evidenceRef) : null;
        const source = sourceRef ? sourceByRef.get(sourceRef) || null : null;
        const localViolations = [];

        if (!sourceRef) localViolations.push({ ...row, reason: 'finding_without_source_ref' });
        else if (!source) localViolations.push({ ...row, reason: 'finding_source_ref_unresolved', sourceRef });

        if (!evidenceRef) localViolations.push({ ...row, reason: 'finding_without_evidence_ref' });
        else if (!evidenceIds.has(evidenceRef)) localViolations.push({ ...row, reason: 'finding_evidence_ref_unresolved', evidenceRef });

        if (source) {
          if (isGenericSource(source)) {
            localViolations.push({ ...row, reason: 'finding_supported_only_by_generic_source', url: source.url || null });
          } else {
            const verificationState = classifySourceVerification(source, policy);
            const requiresOfficial = ['CRITICAL', 'REQUIRED'].includes(criticality);
            const acceptable = requiresOfficial
              ? verificationState === SOURCE_VERIFICATION_STATES.VERIFIED_OFFICIAL
              : verificationState === SOURCE_VERIFICATION_STATES.VERIFIED_OFFICIAL
                || verificationState === SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY;
            if (!acceptable) {
              localViolations.push({
                ...row,
                reason: requiresOfficial ? 'required_finding_source_not_official' : 'finding_source_not_verified',
                verificationState,
                sourceTier: declaredNumber(source.tier),
              });
            }
          }
        }

        if (localViolations.length > 0) {
          violations.push(...localViolations);
          invalidFindings.push({ ...row, reasons: localViolations.map((v) => v.reason) });
        } else {
          validFindings.push({ ...row, origin: 'EXTERNAL', sourceRef, evidenceRef });
        }
      }
    }
  }

  return status(invalidFindings.length === 0 && invalidDerivations.length === 0, {
    violations,
    validFindings,
    invalidFindings,
    derivedFindings,
    invalidDerivations,
    totals: {
      findings: total, valid: validFindings.length, invalid: invalidFindings.length, derived: derivedFindings.length,
    },
    invalidFindingIds: invalidFindings.map((finding) => `${finding.benchmarkId}:${finding.kind}:${finding.id}`),
  });
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
    // §7 `maximumBenchmarkReviewAgeDays` era calculado e nunca usado: a policy
    // declarava review máximo de 365d mas o único limite efetivo era o de
    // source (540d) — a regra MAIS RESTRITA não tinha efeito.
    const reviewTooOld = ageMs > maxReviewAgeMs;
    const effective = declaredStatus === 'STALE' ? 'STALE' : (stale || reviewOverdue || reviewTooOld ? 'STALE' : 'FRESH');
    items.push({
      benchmarkId: benchmark.id,
      researchedAt: benchmark.freshness.researchedAt,
      ageDays: Math.round(ageMs / 86400000),
      nextReviewAt: benchmark.freshness.nextReviewAt || null,
      sourceLastUpdated: benchmark.freshness.sourceLastUpdated || null,
      status: effective,
    });
    if (effective === 'STALE') {
      let reason = 'source_older_than_policy';
      if (reviewOverdue && !stale && !reviewTooOld) reason = 'review_overdue';
      else if (reviewTooOld && !stale) reason = 'review_age_exceeded_policy';
      violations.push({
        benchmarkId: benchmark.id,
        reason,
        ageDays: Math.round(ageMs / 86400000),
        maximumBenchmarkReviewAgeDays: Number(policy.maximumBenchmarkReviewAgeDays),
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
  'evidenceTraceability',
  'findingEvidence',
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

/**
 * §46 Todo percentual precisa vir acompanhado de numerador, denominador,
 * escopo, versão do inventário e estado da amostra. "Fitness Coverage: 100%" é
 * uma afirmação sem sujeito: 100% DE QUÊ, medido contra O QUÊ, com QUAL estado
 * de amostra? Este objeto torna a afirmação completa — ou a impede.
 */
function buildCoverageStatement({
  sample, state, certifiable, findingEvidence, archetypeCoverage, saturation, holdout,
} = {}) {
  const inventorySize = saturation && saturation.curve ? saturation.curve.inventorySize : null;
  const baseline = Number(sample && sample.canonicalInventoryBaseline);
  return {
    scope: `vertical:${sample && sample.vertical ? sample.vertical : 'unknown'}`,
    inventoryVersion: (sample && sample.inventoryVersion) || null,
    sampleVersion: (sample && sample.sampleVersion) || null,
    sampleStatus: state || null,
    certified: certifiable === true,
    dimensions: {
      requiredCapabilities: {
        label: 'Required Capability Implementation',
        numerator: inventorySize,
        denominator: Number.isFinite(baseline) ? baseline : null,
        unit: 'capabilities',
      },
      marketArchetypes: {
        label: 'Market Archetype Coverage',
        numerator: archetypeCoverage ? archetypeCoverage.representedArchetypes : null,
        denominator: archetypeCoverage ? archetypeCoverage.relevantArchetypes : null,
        unit: 'archetypes',
      },
      findings: {
        label: 'Evidence-backed Findings',
        numerator: findingEvidence ? findingEvidence.totals.valid : null,
        denominator: findingEvidence ? findingEvidence.totals.findings : null,
        unit: 'findings',
      },
    },
    holdoutState: (holdout && holdout.holdoutState) || null,
    // Nunca colapsar cobertura de implementação com certificação de mercado.
    marketCertification: certifiable === true ? 'MARKET_SAMPLE_CERTIFIED' : 'MARKET_SAMPLE_NOT_CERTIFIED',
  };
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
  const evidenceTraceability = evaluateEvidenceTraceability({ sample });
  const findingEvidence = evaluateFindingEvidence({ sample, policy });
  const freshness = evaluateFreshness({ sample, policy, now });
  const criticalClassification = evaluateCriticalClassification({ sample });
  const analysisEvidence = evaluateAnalysisEvidence({ sample });

  const inventoryArithmetic = (() => {
    const violations = INVENTORY_DIMENSION_NAMES.flatMap((dimension) => (
      saturation.curves[dimension].arithmeticViolations.map((violation) => ({ ...violation, dimension }))
    ));
    const unknownBaselines = INVENTORY_DIMENSION_NAMES.filter(
      (dimension) => saturation.curves[dimension].baselineState === BASELINE_STATES.UNKNOWN,
    );
    const detail = {
      violations,
      inventoryCurves: Object.fromEntries(INVENTORY_DIMENSION_NAMES.map((dimension) => [
        dimension,
        {
          baseline: saturation.curves[dimension].baseline,
          baselineState: saturation.curves[dimension].baselineState,
          baselineField: saturation.curves[dimension].baselineField,
          inventorySize: saturation.curves[dimension].inventorySize,
        },
      ])),
      unknownBaselines,
    };
    // §10 Baseline ausente é UNKNOWN declarado: não existe PASS silencioso para
    // "o inventário fecha aritmeticamente" quando nem o ponto de partida é conhecido.
    if (violations.length > 0) return status(false, detail);
    if (unknownBaselines.length > 0) {
      return { ...detail, status: 'NOT_MEASURABLE', reason: 'inventory_baseline_unknown', unknownBaselines };
    }
    return status(true, detail);
  })();

  const discovery = discoveryBenchmarks(sample);
  // Floor de governança usa observações REALMENTE independentes (clones
  // colapsados): um white-label declarado como `cloneOf` não pode elevar o piso.
  const independentDiscoveryBenchmarks = effectiveGroupsOf(discovery).size;
  const independentValidationBenchmarks = effectiveGroupsOf(validationBenchmarks(sample)).size;

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
    evidenceTraceability,
    findingEvidence,
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

  // §10/§11/§13 Dimensões cujo índice de novidade não é mensurável (baseline
  // desconhecido ou denominador zero). Não bloqueiam por "falha" — bloqueiam por
  // AUSÊNCIA DE MEDIÇÃO: sem medição não existe suficiência comprovada.
  const unmeasuredDimensions = INVENTORY_DIMENSION_NAMES.filter(
    (dimension) => saturation[INVENTORY_DIMENSIONS[dimension].gate].status === 'NOT_MEASURABLE',
  );

  // Universidade: nenhuma contagem prova suficiência; o estado é derivado dos gates.
  let state;
  if (list(sample.benchmarks).length === 0) state = SAMPLE_STATES.NOT_RESEARCHED;
  else if (analysisEvidence.analysedBenchmarks === 0) state = SAMPLE_STATES.NOT_RESEARCHED;
  else if (String(sample.researchState || '').toUpperCase() === 'RESEARCHING') state = SAMPLE_STATES.RESEARCHING;
  // Descobrir sem evidência não é "descoberta não computada": é inventário
  // inválido. O estado é explícito para que o relatório não possa apresentar
  // findings sem prova como findings válidos.
  else if (findingEvidence.invalidFindings.length > 0 || findingEvidence.invalidDerivations.length > 0) state = SAMPLE_STATES.INVALID_FINDINGS;
  else if (holdout.holdoutState === HOLDOUT_STATES.NOT_ANALYZED) state = SAMPLE_STATES.HOLDOUT_NOT_ANALYZED;
  else if (holdout.status === 'FAIL' && holdout.violations.some((v) => String(v.reason).startsWith('holdout_new_critical') || v.reason === 'holdout_noncritical_novelty_rate_exceeded')) state = SAMPLE_STATES.HOLDOUT_FAILED;
  else if (String(sample.revalidationRequired || '').length > 0) state = SAMPLE_STATES.REVALIDATION_REQUIRED;
  else if (criticalBlocking.length === 0) state = SAMPLE_STATES.SUFFICIENT;
  else state = SAMPLE_STATES.NOT_SATURATED;

  const coverageStatement = buildCoverageStatement({
    sample,
    state,
    certifiable: state === SAMPLE_STATES.SUFFICIENT,
    findingEvidence,
    archetypeCoverage,
    saturation,
    holdout,
  });

  return {
    vertical: sample.vertical,
    sampleVersion: sample.sampleVersion,
    inventoryVersion: sample.inventoryVersion,
    policyVersion: policy.version,
    status: state,
    certifiable: state === SAMPLE_STATES.SUFFICIENT,
    coverageStatement,
    gates,
    blocking,
    criticalBlocking,
    unmeasuredDimensions,
    inventoryCurves: saturation.curves,
    holdoutCurves: holdout.holdoutCurves || null,
    holdoutState: holdout.holdoutState || null,
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
  HOLDOUT_STATES,
  HOLDOUT_ANALYSIS_EVIDENCE_FIELDS,
  EXTERNAL_BLOCK_STATE,
  NOVELTY_KEYS,
  ALL_NOVELTY_KEYS,
  INFORMATION_ONLY_GATES,
  GATE_NAMES,
  listCriticalGates,
  INVENTORY_DIMENSIONS,
  INVENTORY_DIMENSION_NAMES,
  BASELINE_STATES,
  PREVIOUS_SIZE_STATES,
  RATE_STATES,
  declaredNumber,
  buildInventoryCurve,
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
  classifySourceVerification,
  SOURCE_VERIFICATION_STATES,
  SOURCE_VERIFICATION_ORDER,
  evaluateEvidenceTraceability,
  evaluateFindingEvidence,
  isGenericSource,
  evaluateFreshness,
  evaluateCriticalClassification,
  evaluateAnalysisEvidence,
  evaluateSampleSufficiency,
  buildCoverageStatement,
};
