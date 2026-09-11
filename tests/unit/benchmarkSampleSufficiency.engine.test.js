'use strict';

/**
 * BENCHMARK SAMPLE SUFFICIENCY — suíte completa (§41) + anti-gaming (§27) +
 * prova de que qualidade da amostra prevalece sobre quantidade de logos (§43).
 *
 * Nenhum teste aqui usa mock do engine: é o motor determinístico real,
 * alimentado por amostras sintéticas declaradas no próprio teste.
 */

const fs = require('fs');
const path = require('path');

const engine = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
const {
  SAMPLE_STATES,
  evaluateArchetypeCoverage,
  evaluateDiversity,
  evaluateIndependence,
  buildDiscoveryCurve,
  evaluateSaturation,
  evaluateHoldout,
  evaluateLeaveOneOut,
  evaluateOrderSensitivity,
  evaluateSourceQuality,
  evaluateFreshness,
  evaluateAnalysisEvidence,
  detectCorrelatedCloneBenchmarks,
  evaluateSampleSufficiency,
} = engine;

const REPO_ROOT = path.join(__dirname, '..', '..');
const POLICY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json'), 'utf8'));
const FITNESS_SAMPLE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'benchmarks', 'fitness.json'), 'utf8'));

const NOW = new Date('2026-09-10T12:00:00.000Z');

function novelty(overrides = {}) {
  return { ...engine.emptyNovelty(), ...overrides };
}

function benchmark(overrides = {}) {
  return {
    id: 'b',
    role: 'discovery',
    order: 1,
    archetype: 'a1',
    independenceGroup: 'g',
    analyzedAt: '2026-09-01T00:00:00.000Z',
    inventoryVersion: 'inv-1',
    previousInventorySize: 100,
    novelty: novelty(),
    sources: [{ tier: 1, url: 'https://oficial', retrievedAt: '2026-09-01', verified: true }],
    freshness: { researchedAt: '2026-09-01', nextReviewAt: '2027-03-01', status: 'FRESH' },
    dimensions: { marketArchetype: 'a1', geography: 'BR' },
    ...overrides,
  };
}

function sample(overrides = {}) {
  return {
    vertical: 'test',
    sampleVersion: 'test-v1',
    inventoryVersion: 'inv-1',
    // §8 O baseline canônico é NÃO-ZERO e entra na aritmética: os
    // `previousInventorySize` da fixture precisam ser coerentes com ele.
    canonicalInventoryBaseline: 100,
    // §9/§10 jornadas e regras têm baseline PRÓPRIO: sem ele a taxa de novidade
    // da dimensão é NOT_MEASURABLE (não existe PASS por omissão).
    canonicalJourneyInventoryBaseline: 10,
    canonicalBusinessRuleInventoryBaseline: 10,
    archetypes: [
      { id: 'a1', importance: 'REQUIRED', status: 'ACTIVE' },
      { id: 'a2', importance: 'REQUIRED', status: 'ACTIVE' },
    ],
    marketScarcityExceptions: [],
    benchmarks: [],
    criticalityRegistry: {},
    criticalityOverrides: [],
    unclassifiedCriticalCapabilities: [],
    unclassifiedCriticalJourneys: [],
    unclassifiedCriticalRules: [],
    holdout: {
      benchmarkId: 'h1',
      selectedAsHoldoutAt: '2026-08-01T00:00:00.000Z',
      selectionReason: 'pré-registrado',
      selectionEvidence: 'doc',
      marketArchetype: 'a2',
      inventoryVersion: 'inv-1',
    },
    ...overrides,
  };
}

/** Amostra saturada padrão: 5 discovery independentes + 1 holdout.
 *  O primeiro benchmark define o catálogo; os seguintes não acrescentam nada —
 *  é essa ausência material de novidade que caracteriza saturação (e torna a
 *  certificação robusta à ordem de análise, §28). */
function saturatedSample() {
  const caps = (n, offset = 0) => Array.from({ length: n }, (_, i) => `cap-${offset + i}`);
  return sample({
    benchmarks: [
      benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', previousInventorySize: 100, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
      benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', previousInventorySize: 100, dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
      benchmark({ id: 'b3', order: 3, archetype: 'a1', independenceGroup: 'g3', previousInventorySize: 100, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
      benchmark({ id: 'b4', order: 4, archetype: 'a2', independenceGroup: 'g4', previousInventorySize: 100, dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
      benchmark({ id: 'b5', order: 5, archetype: 'a1', independenceGroup: 'g5', previousInventorySize: 100, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
      benchmark({ id: 'h1', role: 'validation', order: 6, archetype: 'a2', independenceGroup: 'gh', previousInventorySize: 100, dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
    ],
  });
}

// ── §3 Arquétipos ─────────────────────────────────────────────────────────

describe('market archetype discovery e cobertura (§3, §12)', () => {
  it('cobre 100% dos arquétipos REQUIRED quando todos têm representante', () => {
    const result = evaluateArchetypeCoverage({ sample: saturatedSample() });
    expect(result.status).toBe('PASS');
    expect(result.coverageRate).toBe(1);
    expect(result.relevantArchetypes).toBe(2);
    expect(result.representedArchetypes).toBe(2);
  });

  it('arquétipo REQUIRED sem representante FALHA com a lista explícita', () => {
    const s = saturatedSample();
    s.archetypes.push({ id: 'a3', importance: 'REQUIRED', status: 'ACTIVE' });
    const result = evaluateArchetypeCoverage({ sample: s });
    expect(result.status).toBe('FAIL');
    expect(result.missingArchetypes).toEqual(['a3']);
  });

  it('MARKET_SCARCITY_EXCEPTION justificada é honrada (não ignora o arquétipo)', () => {
    const s = saturatedSample();
    s.archetypes.push({ id: 'a3', importance: 'REQUIRED', status: 'NO_BENCHMARK_AVAILABLE' });
    expect(evaluateArchetypeCoverage({ sample: s }).status).toBe('FAIL');

    s.marketScarcityExceptions = [{ archetype: 'a3', evidence: 'não existe fornecedor representativo', documentedAt: '2026-09-01' }];
    const result = evaluateArchetypeCoverage({ sample: s });
    expect(result.status).toBe('PASS');
    expect(result.exceptions).toHaveLength(1);
  });

  it('arquétipo OPTIONAL sem representante não bloqueia', () => {
    const s = saturatedSample();
    s.archetypes.push({ id: 'a9', importance: 'OPTIONAL', status: 'ACTIVE' });
    expect(evaluateArchetypeCoverage({ sample: s }).status).toBe('PASS');
  });
});

// ── §29 Independência e clones ────────────────────────────────────────────

describe('independência corporativa e clones (§29, §27)', () => {
  it('benchmarks do mesmo independence_group não contam como observações independentes', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, independenceGroup: 'same' }),
        benchmark({ id: 'b2', order: 2, independenceGroup: 'same' }),
        benchmark({ id: 'b3', order: 3, independenceGroup: 'other' }),
      ],
    });
    const result = evaluateIndependence({ sample: s });
    expect(result.independentDiscoveryBenchmarks).toBe(2);
    expect(result.duplicatedGroups).toEqual([{ group: 'same', ids: ['b1', 'b2'] }]);
  });

  it('declaração de clone/white-label é detectada e reduz a independência', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, independenceGroup: 'g1', archetype: 'a1' }),
        benchmark({ id: 'b2', order: 2, independenceGroup: 'g2', archetype: 'a2', cloneOf: 'b1' }),
      ],
    });
    const result = detectCorrelatedCloneBenchmarks({ sample: s });
    expect(result.cloneDeclarations).toEqual([{ benchmarkId: 'b2', cloneOf: 'b1' }]);
    expect(result.independentShare).toBe(0.5);
  });
});

// ── §7/§8 Curvas de descoberta ────────────────────────────────────────────

describe('curvas de descoberta (§7, §8)', () => {
  it('a curva respeita a ORDEM registrada e acumula o inventário', () => {
    const curve = buildDiscoveryCurve({ sample: saturatedSample() });
    expect(curve.points.map((p) => p.benchmarkId)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    // §8 O inventário começa no BASELINE canônico (100), não em 0. Nenhum
    // benchmark acrescenta item: a amostra é saturada e o inventário fecha em
    // 100 — antes desta correção o baseline era ignorado e a curva começava
    // do zero, reportando inventário 0 com violação aritmética.
    expect(curve.points[0].previousInventorySize).toBe(100);
    expect(curve.points[1].previousInventorySize).toBe(100);
    expect(curve.inventorySize).toBe(100);
    expect(curve.arithmeticViolations).toEqual([]);
  });

  it('capacidade nova sem jornada nova continua sendo novidade de capability', () => {
    const s = sample({
      benchmarks: [benchmark({ id: 'b1', order: 1, previousInventorySize: 0, novelty: novelty({ newCapabilities: ['x'] }) })],
    });
    const curve = buildDiscoveryCurve({ sample: s });
    expect(curve.points[0].newCapabilities).toBe(1);
    expect(curve.points[0].newJourneys).toBe(0);
  });

  it('mede jornadas e regras de negócio separadamente das capabilities', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, previousInventorySize: 0, novelty: novelty({ newCapabilities: ['c1'] }) }),
        benchmark({
          id: 'b2',
          order: 2,
          independenceGroup: 'g2',
          archetype: 'a2',
          previousInventorySize: 1,
          novelty: novelty({ newJourneys: ['j1'], newCriticalJourneys: ['j2'], newBusinessRules: ['r1'], newCriticalBusinessRules: ['r2'] }),
        }),
      ],
    });
    const curve = buildDiscoveryCurve({ sample: s });
    expect(curve.points[1].newJourneys).toBe(1);
    expect(curve.points[1].newCriticalJourneys).toBe(1);
    expect(curve.points[1].newBusinessRules).toBe(1);
    expect(curve.points[1].newCriticalBusinessRules).toBe(1);
  });

  it('novidade zero de capability NÃO implica saturação se há jornada crítica nova', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, previousInventorySize: 0, novelty: novelty({ newCapabilities: ['c1'] }) }),
        benchmark({ id: 'b2', order: 2, independenceGroup: 'g2', archetype: 'a2', previousInventorySize: 1, novelty: novelty() }),
        benchmark({ id: 'b3', order: 3, independenceGroup: 'g3', archetype: 'a1', previousInventorySize: 1, novelty: novelty({ newCriticalJourneys: ['j-critical'] }) }),
      ],
    });
    const saturation = evaluateSaturation({ sample: s, policy: POLICY });
    expect(saturation.capability.status).toBe('PASS');
    expect(saturation.journey.status).toBe('FAIL');
  });

  it('regra de negócio crítica nova reprova a saturação de regras mesmo com capabilities saturadas', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, previousInventorySize: 0, novelty: novelty({ newCapabilities: ['c1'] }) }),
        benchmark({ id: 'b2', order: 2, independenceGroup: 'g2', archetype: 'a2', previousInventorySize: 1, novelty: novelty({ newCriticalBusinessRules: ['freeze_interrupts_billing'] }) }),
      ],
    });
    const saturation = evaluateSaturation({ sample: s, policy: POLICY });
    expect(saturation.capability.status).toBe('PASS');
    expect(saturation.businessRule.status).toBe('FAIL');
  });
});

// ── §9/§10/§11 Saturação e janela ─────────────────────────────────────────

describe('janela de saturação (§9, §10, §11)', () => {
  it('usa apenas observações independentes na janela', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, independenceGroup: 'g1', archetype: 'a1', previousInventorySize: 0, novelty: novelty({ newCapabilities: ['c1'] }) }),
        benchmark({ id: 'b2', order: 2, independenceGroup: 'g1', archetype: 'a1', previousInventorySize: 1, novelty: novelty({ newCapabilities: ['c2', 'c3', 'c4', 'c5', 'c6', 'c7'] }) }),
        benchmark({ id: 'b3', order: 3, independenceGroup: 'g2', archetype: 'a2', previousInventorySize: 1, novelty: novelty() }),
      ],
    });
    const saturation = evaluateSaturation({ sample: s, policy: POLICY });
    // b2 é do MESMO grupo de b1: não entra como observação independente.
    expect(saturation.window.map((p) => p.benchmarkId)).toEqual(['b1', 'b3']);
    expect(saturation.capability.status).toBe('PASS');
  });

  it('janela incompleta não pode produzir saturação', () => {
    const s = sample({
      benchmarks: [benchmark({ id: 'b1', order: 1, previousInventorySize: 0, novelty: novelty({ newCapabilities: ['c1'] }) })],
    });
    const saturation = evaluateSaturation({ sample: s, policy: POLICY });
    expect(saturation.capability.insufficientWindow).toBe(true);
    expect(saturation.capability.status).toBe('FAIL');
  });

  it('taxa de novidade acima da política reprova a janela', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, independenceGroup: 'g1', archetype: 'a1', previousInventorySize: 0, novelty: novelty({ newCapabilities: ['c1'] }) }),
        benchmark({ id: 'b2', order: 2, independenceGroup: 'g2', archetype: 'a2', previousInventorySize: 100, novelty: novelty({ newCapabilities: Array.from({ length: 20 }, (_, i) => `x${i}`) }) }),
        benchmark({ id: 'b3', order: 3, independenceGroup: 'g3', archetype: 'a1', previousInventorySize: 120, novelty: novelty({ newCapabilities: Array.from({ length: 20 }, (_, i) => `y${i}`) }) }),
      ],
    });
    expect(evaluateSaturation({ sample: s, policy: POLICY }).capability.status).toBe('FAIL');
  });
});

// ── §6/§14/§15/§16 Holdout ────────────────────────────────────────────────

describe('holdout: pré-registro, leakage, sucesso e falha (§6, §14, §15, §16)', () => {
  it('holdout sem pré-registro FALHA com os campos exigidos', () => {
    const s = sample({ holdout: null });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).toBe('FAIL');
    expect(result.violations[0].reason).toBe('holdout_not_preregistered');
    expect(result.requiredPreregistrationFields).toContain('selectedAsHoldoutAt');
  });

  it('pré-registro incompleto FALHA campo a campo', () => {
    const s = sample({ holdout: { benchmarkId: 'h1' } });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).toBe('FAIL');
    expect(result.violations.filter((v) => v.reason === 'holdout_preregistration_incomplete').map((v) => v.field))
      .toEqual(expect.arrayContaining(['selectedAsHoldoutAt', 'selectionReason', 'selectionEvidence', 'marketArchetype', 'inventoryVersion']));
  });

  it('LEAKAGE: holdout analisado antes de ser reservado FALHA (§6)', () => {
    const s = saturatedSample();
    s.holdout.selectedAsHoldoutAt = '2026-09-05T00:00:00.000Z';
    s.benchmarks.find((b) => b.id === 'h1').analyzedAt = '2026-09-01T00:00:00.000Z';
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.reason === 'holdout_leakage_analyzed_before_preregistration')).toBe(true);
  });

  it('SUCESSO: holdout com novidade não crítica residual dentro da política PASSA', () => {
    const result = evaluateHoldout({ sample: saturatedSample(), policy: POLICY });
    expect(result.status).toBe('PASS');
    expect(result.newCriticalCapabilities).toBe(0);
  });

  it('FALHA ABSOLUTA: capability crítica REQUIRED nova no holdout', () => {
    const s = saturatedSample();
    s.benchmarks.find((b) => b.id === 'h1').novelty = novelty({ newCriticalCapabilities: [{ id: 'cap-x', required: true }] });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.reason === 'holdout_new_critical_required_capabilities')).toBe(true);
  });

  it('FALHA ABSOLUTA: jornada crítica nova no holdout', () => {
    const s = saturatedSample();
    s.benchmarks.find((b) => b.id === 'h1').novelty = novelty({ newCriticalJourneys: ['j-x'] });
    expect(evaluateHoldout({ sample: s, policy: POLICY }).status).toBe('FAIL');
  });

  it('FALHA ABSOLUTA: regra de negócio crítica nova no holdout', () => {
    const s = saturatedSample();
    s.benchmarks.find((b) => b.id === 'h1').novelty = novelty({ newCriticalBusinessRules: ['r-x'] });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.reason === 'holdout_new_critical_business_rules')).toBe(true);
  });

  it('novidade não crítica acima da política também FALHA', () => {
    const s = saturatedSample();
    s.benchmarks.find((b) => b.id === 'h1').novelty = novelty({ newCapabilities: Array.from({ length: 50 }, (_, i) => `n${i}`) });
    expect(evaluateHoldout({ sample: s, policy: POLICY }).status).toBe('FAIL');
  });

  it('holdout desconhecido FALHA explicitamente', () => {
    const s = saturatedSample();
    s.holdout.benchmarkId = 'nao-existe';
    expect(evaluateHoldout({ sample: s, policy: POLICY }).violations[0].reason).toBe('holdout_benchmark_not_found');
  });
});

// ── §17 Leave-one-out ─────────────────────────────────────────────────────

describe('sensibilidade leave-one-out (§17)', () => {
  it('aponta concentração informacional e arquétipo que se perderia', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', novelty: novelty({ newCapabilities: Array.from({ length: 40 }, (_, i) => `a${i}`) }) }),
        benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', novelty: novelty({ newCapabilities: ['b1'] }) }),
      ],
    });
    const result = evaluateLeaveOneOut({ sample: s });
    expect(result.concentration.topBenchmarkId).toBe('b1');
    expect(result.concentration.topShare).toBeGreaterThan(0.9);
    expect(result.items.find((i) => i.benchmarkId === 'b1').archetypeWouldBeLost).toBe(true);
  });
});

// ── §28 Ordem ─────────────────────────────────────────────────────────────

describe('sensibilidade de ordem (§28)', () => {
  it('detecta resultado dependente da ordem', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, independenceGroup: 'g1', archetype: 'a1', previousInventorySize: 0, novelty: novelty({ newCapabilities: Array.from({ length: 10 }, (_, i) => `a${i}`) }) }),
        benchmark({ id: 'b2', order: 2, independenceGroup: 'g2', archetype: 'a2', previousInventorySize: 10, novelty: novelty({ newCapabilities: Array.from({ length: 10 }, (_, i) => `b${i}`) }) }),
        benchmark({ id: 'b3', order: 3, independenceGroup: 'g3', archetype: 'a1', previousInventorySize: 20, novelty: novelty({ newCapabilities: [] }) }),
      ],
    });
    const result = evaluateOrderSensitivity({ sample: s, policy: POLICY });
    expect(['LOW', 'HIGH']).toContain(result.orderSensitivity);
    expect(Array.isArray(result.variants)).toBe(true);
  });

  it('ordem estável reporta LOW', () => {
    // Curva já saturada: qualquer permutação mantém novidade zero na janela,
    // então a saturação não pode depender da ordem.
    const saturated = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', previousInventorySize: 0, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty({ newCapabilities: ['c1'] }) }),
        benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', previousInventorySize: 1, dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
        benchmark({ id: 'b3', order: 3, archetype: 'a1', independenceGroup: 'g3', previousInventorySize: 1, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
        benchmark({ id: 'h1', role: 'validation', order: 4, archetype: 'a2', independenceGroup: 'gh', previousInventorySize: 1, dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
      ],
    });
    expect(evaluateOrderSensitivity({ sample: saturated, policy: POLICY }).orderSensitivity).toBe('LOW');
  });
});

// ── §18/§19 Fontes e frescor ──────────────────────────────────────────────

describe('qualidade e frescor das fontes (§18, §19)', () => {
  it('benchmark sem fonte FALHA', () => {
    const s = sample({ benchmarks: [benchmark({ id: 'b1', sources: [] })] });
    const result = evaluateSourceQuality({ sample: s, policy: POLICY });
    expect(result.status).toBe('FAIL');
    expect(result.violations[0].reason).toBe('benchmark_without_source');
  });

  it('fonte abaixo do tier mínimo FALHA', () => {
    const s = sample({ benchmarks: [benchmark({ id: 'b1', sources: [{ tier: 8, url: 'https://blog', retrievedAt: '2026-09-01' }] })] });
    const reasons = evaluateSourceQuality({ sample: s, policy: POLICY }).violations.map((v) => v.reason);
    // Tier 8 é "somente apoio": além de ficar abaixo do tier aceito, não é
    // fonte OFICIAL verificada (§15) — as duas violações são exigidas.
    expect(reasons).toContain('source_tier_below_minimum');
    expect(reasons).toContain('benchmark_without_verified_official_source');
  });

  it('capability crítica apoiada apenas em fonte de baixa confiança FALHA', () => {
    const s = sample({
      benchmarks: [benchmark({
        id: 'b1',
        sources: [{ tier: 7, url: 'https://secundaria', retrievedAt: '2026-09-01', verified: true }],
        novelty: novelty({ newCriticalCapabilities: [{ id: 'cap-critica', required: true }] }),
      })],
    });
    const result = evaluateSourceQuality({ sample: s, policy: POLICY });
    expect(result.status).toBe('FAIL');
    expect(result.violations.some((v) => v.reason === 'critical_finding_supported_only_by_low_confidence_source')).toBe(true);
  });

  it('fonte antiga FALHA no frescor', () => {
    const s = sample({ benchmarks: [benchmark({ id: 'b1', freshness: { researchedAt: '2024-01-01', status: 'FRESH' } })] });
    const result = evaluateFreshness({ sample: s, policy: POLICY, now: NOW });
    expect(result.status).toBe('FAIL');
    expect(result.violations[0].reason).toBe('source_older_than_policy');
  });

  it('revisão vencida FALHA mesmo com pesquisa recente', () => {
    const s = sample({ benchmarks: [benchmark({ id: 'b1', freshness: { researchedAt: '2026-09-01', nextReviewAt: '2026-09-05' } })] });
    const result = evaluateFreshness({ sample: s, policy: POLICY, now: NOW });
    expect(result.violations[0].reason).toBe('review_overdue');
  });

  it('frescor explícito STALE é respeitado', () => {
    const s = sample({ benchmarks: [benchmark({ id: 'b1', freshness: { researchedAt: '2026-09-01', status: 'STALE' } })] });
    expect(evaluateFreshness({ sample: s, policy: POLICY, now: NOW }).status).toBe('FAIL');
  });

  it('ausência de researchedAt FALHA', () => {
    const s = sample({ benchmarks: [benchmark({ id: 'b1', freshness: {} })] });
    expect(evaluateFreshness({ sample: s, policy: POLICY, now: NOW }).violations[0].reason).toBe('missing_researched_at');
  });
});

// ── §27 Anti-gaming ───────────────────────────────────────────────────────

describe('anti-gaming (§27, §43)', () => {
  it('AMOSTRA DE LOGOS: 10 benchmarks do mesmo arquétipo FALHA', () => {
    const s = sample({
      benchmarks: Array.from({ length: 10 }, (_, i) => benchmark({
        id: `b${i}`, order: i + 1, archetype: 'a1', independenceGroup: `g${i}`,
        previousInventorySize: 0, novelty: novelty(),
      })),
    });
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
    expect(result.gates.marketArchetypeCoverage.status).toBe('FAIL');
    expect(result.gates.benchmarkDiversity.status).toBe('FAIL');
  });

  it('cinco benchmarks bem distribuídos e saturados podem ser SUFICIENTE (§43)', () => {
    const result = evaluateSampleSufficiency({ sample: saturatedSample(), policy: POLICY, now: NOW });
    expect(result.status).toBe(SAMPLE_STATES.SUFFICIENT);
    expect(result.certifiable).toBe(true);
  });

  it('retirar um concorrente que revelou gap muda o veredito (não é possível esconder)', () => {
    const s = saturatedSample();
    // b5 era o benchmark que revelou uma journey crítica → passa a inexistente
    const withGap = JSON.parse(JSON.stringify(s));
    withGap.benchmarks.find((b) => b.id === 'b5').novelty = novelty({ newCriticalJourneys: ['j-gap'] });
    expect(evaluateSampleSufficiency({ sample: withGap, policy: POLICY, now: NOW }).status).not.toBe(SAMPLE_STATES.SUFFICIENT);
  });

  it('rebaixar criticalidade herdada sem justificativa FALHA', () => {
    const s = saturatedSample();
    s.criticalityRegistry = { 'cap-critica': 'CRITICAL' };
    s.criticalityOverrides = [{ id: 'cap-critica', to: 'OPTIONAL' }];
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.gates.criticalClassification.status).toBe('FAIL');
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
  });

  it('criticalidade herdada só pode ser rebaixada com justificativa registrada', () => {
    const s = saturatedSample();
    s.criticalityRegistry = { 'cap-critica': 'CRITICAL' };
    s.criticalityOverrides = [{ id: 'cap-critica', to: 'OPTIONAL', justification: 'fora de escopo declarado (decisão versionada)' }];
    expect(evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW }).gates.criticalClassification.status).toBe('PASS');
  });

  it('capability crítica não classificada bloqueia a certificação (§40)', () => {
    const s = saturatedSample();
    s.unclassifiedCriticalCapabilities = ['cap-orfa'];
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
    expect(result.gates.criticalClassification.unclassifiedCriticalCapabilities).toBe(1);
  });

  it('journey crítica não classificada bloqueia a certificação', () => {
    const s = saturatedSample();
    s.unclassifiedCriticalJourneys = ['j-orfa'];
    expect(evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW }).status).not.toBe(SAMPLE_STATES.SUFFICIENT);
  });

  it('regra crítica não classificada bloqueia a certificação', () => {
    const s = saturatedSample();
    s.unclassifiedCriticalRules = ['r-orfa'];
    expect(evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW }).status).not.toBe(SAMPLE_STATES.SUFFICIENT);
  });

  it('MANIPULAÇÃO DE DENOMINADOR: previousInventorySize incoerente FALHA', () => {
    const s = saturatedSample();
    s.benchmarks.find((b) => b.id === 'b3').previousInventorySize = 1; // deveria ser 103
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.gates.inventoryArithmetic.status).toBe('FAIL');
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
  });

  it('AMOSTRA NÃO ANALISADA não pode passar (declarar nada ≠ saturar)', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', analyzedAt: null, previousInventorySize: 0 }),
        benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', analyzedAt: null, previousInventorySize: 0 }),
        benchmark({ id: 'h1', role: 'validation', order: 3, archetype: 'a2', independenceGroup: 'gh', analyzedAt: null, previousInventorySize: 0 }),
      ],
    });
    const evidence = evaluateAnalysisEvidence({ sample: s });
    expect(evidence.status).toBe('FAIL');
    expect(evidence.analysedBenchmarks).toBe(0);
    expect(evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW }).status).toBe(SAMPLE_STATES.NOT_RESEARCHED);
  });

  it('sem baseline de inventário canônico não há certificação', () => {
    const s = saturatedSample();
    delete s.canonicalInventoryBaseline;
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.gates.analysisEvidence.status).toBe('FAIL');
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
  });

  it('benchmark sem inventoryVersion FALHA', () => {
    const s = saturatedSample();
    delete s.benchmarks[0].inventoryVersion;
    expect(evaluateAnalysisEvidence({ sample: s }).status).toBe('FAIL');
  });
});

// ── §20/§21/§39 Versionamento e revalidação ───────────────────────────────

describe('versão da amostra e revalidação (§20, §21, §39)', () => {
  it('novo concorrente relevante reabre a certificação (REVALIDATION_REQUIRED)', () => {
    const s = saturatedSample();
    s.revalidationRequired = { reason: 'novo concorrente relevante F detectado', detectedAt: '2026-09-10' };
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.status).toBe(SAMPLE_STATES.REVALIDATION_REQUIRED);
    expect(result.certifiable).toBe(false);
  });

  it('o PASS é atrelado à versão da amostra (v1 não certifica v2)', () => {
    const v1 = saturatedSample();
    const result = evaluateSampleSufficiency({ sample: v1, policy: POLICY, now: NOW });
    expect(result.sampleVersion).toBe('test-v1');
    expect(result.inventoryVersion).toBe('inv-1');

    const v2 = { ...saturatedSample(), sampleVersion: 'test-v2', benchmarks: [] };
    const resultV2 = evaluateSampleSufficiency({ sample: v2, policy: POLICY, now: NOW });
    expect(resultV2.sampleVersion).toBe('test-v2');
    expect(resultV2.status).toBe(SAMPLE_STATES.NOT_RESEARCHED);
  });

  it('falha de holdout produz SAMPLE_HOLDOUT_FAILED', () => {
    const s = saturatedSample();
    s.benchmarks.find((b) => b.id === 'h1').novelty = novelty({ newCriticalJourneys: ['j-nova'] });
    expect(evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW }).status).toBe(SAMPLE_STATES.HOLDOUT_FAILED);
  });

  it('amostra vazia é SAMPLE_NOT_RESEARCHED', () => {
    expect(evaluateSampleSufficiency({ sample: sample({ benchmarks: [] }), policy: POLICY, now: NOW }).status)
      .toBe(SAMPLE_STATES.NOT_RESEARCHED);
  });

  it('piso de governança: holdout ausente sem exceção bloqueia', () => {
    const s = saturatedSample();
    s.benchmarks = s.benchmarks.filter((b) => b.role !== 'validation');
    s.holdout = null;
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.gates.governanceFloor.status).toBe('FAIL');
  });

  it('piso de governança: poucos benchmarks independentes bloqueia mesmo com curva “bonita”', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, independenceGroup: 'g1', archetype: 'a1', previousInventorySize: 0, novelty: novelty({ newCapabilities: ['c1'] }) }),
        benchmark({ id: 'h1', role: 'validation', order: 2, independenceGroup: 'gh', archetype: 'a2', previousInventorySize: 1, novelty: novelty() }),
      ],
    });
    expect(evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW }).gates.governanceFloor.status).toBe('FAIL');
  });
});

// ── §25 Critical gaps prevalecem sobre score ──────────────────────────────

describe('gap crítico prevalece sobre qualquer média (§25, §40)', () => {
  it('um único achado crítico derruba a certificação ainda que todos os outros gates passem', () => {
    const s = saturatedSample();
    s.benchmarks.find((b) => b.id === 'h1').novelty = novelty({ newCriticalCapabilities: [{ id: 'cap-unica', required: true }] });
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.gates.capabilitySaturation.status).toBe('PASS');
    expect(result.gates.marketArchetypeCoverage.status).toBe('PASS');
    expect(result.status).toBe(SAMPLE_STATES.HOLDOUT_FAILED);
    expect(result.certifiable).toBe(false);
  });
});

// ── Amostra real do repositório ───────────────────────────────────────────

describe('amostra real da vertical Fitness (estado honesto)', () => {
  it('não declara suficiência sem análise e registra o bloqueio externo', () => {
    const result = evaluateSampleSufficiency({ sample: FITNESS_SAMPLE, policy: POLICY, now: NOW });
    expect(result.status).toBe(SAMPLE_STATES.NOT_RESEARCHED);
    expect(result.certifiable).toBe(false);
    expect(FITNESS_SAMPLE.sampleSufficiencyClaim).toBeUndefined();
    expect(FITNESS_SAMPLE.externalBlock.code).toBe(engine.EXTERNAL_BLOCK_STATE);
  });

  it('EVO está presente como benchmark obrigatório (§31)', () => {
    const evo = FITNESS_SAMPLE.benchmarks.find((b) => b.id === 'evo-w12');
    expect(evo).toBeDefined();
    expect(evo.mandatory).toBe(true);
    expect(evo.sources.length).toBeGreaterThan(0);
  });

  it('holdout está pré-registrado antes de qualquer análise', () => {
    expect(FITNESS_SAMPLE.holdout).toBeDefined();
    expect(FITNESS_SAMPLE.holdout.selectedAsHoldoutAt).toBeTruthy();
    expect(FITNESS_SAMPLE.holdout.selectionReason).toBeTruthy();
    expect(FITNESS_SAMPLE.holdout.selectionEvidence).toBeTruthy();
    const holdoutBenchmark = FITNESS_SAMPLE.benchmarks.find((b) => b.id === FITNESS_SAMPLE.holdout.benchmarkId);
    expect(holdoutBenchmark.role).toBe('validation');
    expect(holdoutBenchmark.analyzedAt).toBeNull();
  });

  it('toda fonte declarada é oficial e verificada (tier ≤ 5)', () => {
    for (const b of FITNESS_SAMPLE.benchmarks) {
      expect(b.sources.length).toBeGreaterThan(0);
      for (const source of b.sources) {
        expect(source.tier).toBeLessThanOrEqual(5);
        expect(source.verified).toBe(true);
        expect(String(source.url)).toMatch(/^https:\/\//);
      }
    }
  });

  it('nenhum novelty foi inventado', () => {
    for (const b of FITNESS_SAMPLE.benchmarks) {
      for (const key of engine.ALL_NOVELTY_KEYS) {
        expect(Array.isArray(b.novelty[key])).toBe(true);
        expect(b.novelty[key]).toHaveLength(0);
      }
    }
  });

  it('arquétipos identificados têm evidência declarada', () => {
    expect(FITNESS_SAMPLE.archetypes.length).toBeGreaterThan(3);
    for (const archetype of FITNESS_SAMPLE.archetypes) {
      expect(String(archetype.evidence || '').length).toBeGreaterThan(10);
      expect(['REQUIRED', 'RELEVANT', 'OPTIONAL']).toContain(archetype.importance);
    }
  });
});

// ── Política versionada ───────────────────────────────────────────────────

describe('thresholds são política, não constante de código (§9)', () => {
  it('o engine não contém thresholds hardcoded: mudar a política muda o veredito', () => {
    // Novidade pequena mas não nula (1 capability em 100 = 1%) na janela:
    // passa com teto de 5% e falha com teto de 0%.
    const decaying = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', previousInventorySize: 0, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty({ newCapabilities: Array.from({ length: 100 }, (_, i) => `c${i}`) }) }),
        benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', previousInventorySize: 100, dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty({ newCapabilities: ['n1'] }) }),
        benchmark({ id: 'b3', order: 3, archetype: 'a1', independenceGroup: 'g3', previousInventorySize: 101, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty({ newCapabilities: ['n2'] }) }),
      ],
    });
    expect(evaluateSaturation({ sample: decaying, policy: POLICY }).capability.status).toBe('PASS');
    const strict = { ...POLICY, maxNoncriticalCapabilityNoveltyRate: 0 };
    expect(evaluateSaturation({ sample: decaying, policy: strict }).capability.status).toBe('FAIL');
  });

  it('a política exige rationale para cada threshold', () => {
    for (const key of ['saturationWindow', 'maxNoncriticalCapabilityNoveltyRate', 'maxHoldoutNoncriticalNoveltyRate']) {
      expect(POLICY.rationale[key]).toBeDefined();
    }
  });
});
