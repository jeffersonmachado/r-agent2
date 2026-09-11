'use strict';

/**
 * MISSÃO CORRETIVA §8–§13 — ARITMÉTICA DE INVENTÁRIO E DENOMINADORES.
 *
 * §8  `canonicalInventoryBaseline` era ignorado: a curva começava em 0, então um
 *     inventário canônico de 12 com 3 capacidades novas reportava 3/0 (ou pior,
 *     inventário final 3). O correto é 3/12 e inventário 15.
 * §9  novidade de jornada/regra usava o inventário de CAPABILITIES como
 *     denominador — métrica errada, capaz de mascarar novidade real.
 * §10 baselines independentes por dimensão; ausência = UNKNOWN/NOT_READY
 *     declarado, nunca 0 silencioso.
 * §11 denominador zero não pode produzir NaN, Infinity, 0 artificial nem 1
 *     artificial.
 * §12 três curvas independentes (capabilities, journeys, businessRules).
 * §13 a mesma modelagem de estágios para o holdout.
 */

const fs = require('fs');
const path = require('path');

const engine = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
const {
  SAMPLE_STATES,
  evaluateSampleSufficiency,
  evaluateSaturation,
  evaluateHoldout,
  buildInventoryCurve,
} = engine;

const REPO_ROOT = path.join(__dirname, '..', '..');
const POLICY = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json'), 'utf8'),
);
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
    // §5 do hardening: análise declarada exige EVIDÊNCIA de análise.
    researchVersion: 'research-1',
    findingsInventory: [],
    marketArchetypeMapping: { archetype: 'a1', rationale: 'mapeamento declarado', evidence: 'https://oficial/docs' },
    novelty: novelty(),
    sources: [{ tier: 1, url: 'https://oficial', retrievedAt: '2026-09-01', verified: true }],
    freshness: { researchedAt: '2026-09-01', nextReviewAt: '2027-03-01', status: 'FRESH' },
    dimensions: { marketArchetype: 'a1', geography: 'BR' },
    ...overrides,
  };
}

/** Fixture base CONSISTENTE: baseline 0 e o primeiro benchmark declara 0. */
function sample(overrides = {}) {
  return {
    vertical: 'test',
    sampleVersion: 'test-v1',
    inventoryVersion: 'inv-1',
    canonicalInventoryBaseline: 0,
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

function caps(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => `cap-${offset + i}`);
}

// ── §8 BASELINE CANÔNICO ──────────────────────────────────────────────────

describe('§8 o baseline canônico entra na aritmética', () => {
  it('baseline 12 + 3 capacidades novas → 3/12 e inventário 15', () => {
    const s = sample({
      canonicalInventoryBaseline: 12,
      benchmarks: [
        benchmark({ id: 'b1', order: 1, previousInventorySize: 12, novelty: novelty({ newCapabilities: ['c1', 'c2', 'c3'] }) }),
      ],
    });
    const curve = buildInventoryCurve({ sample: s, dimension: 'capabilities' });

    expect(curve.baseline).toBe(12);
    expect(curve.baselineState).toBe('DECLARED');
    expect(curve.points[0].previousInventorySize).toBe(12);
    expect(curve.points[0].noveltyRate).toBe(0.25);
    expect(curve.points[0].cumulativeInventorySize).toBe(15);
    expect(curve.inventorySize).toBe(15);
    expect(curve.arithmeticViolations).toEqual([]);
  });

  it('declarar 0 quando o baseline é 12 é contradição aritmética', () => {
    const s = sample({
      canonicalInventoryBaseline: 12,
      benchmarks: [benchmark({ id: 'b1', order: 1, previousInventorySize: 0 })],
    });
    const curve = buildInventoryCurve({ sample: s, dimension: 'capabilities' });
    expect(curve.arithmeticViolations).toEqual([
      { benchmarkId: 'b1', declared: 0, expectedFromCurve: 12 },
    ]);
  });

  it('baseline AUSENTE → UNKNOWN explícito, inventário null (nunca 0 silencioso)', () => {
    const s = sample({
      canonicalInventoryBaseline: null,
      benchmarks: [benchmark({ id: 'b1', order: 1, previousInventorySize: null, novelty: novelty({ newCapabilities: ['c1'] }) })],
    });
    const curve = buildInventoryCurve({ sample: s, dimension: 'capabilities' });

    expect(curve.baseline).toBeNull();
    expect(curve.baselineState).toBe('UNKNOWN');
    expect(curve.inventorySize).toBeNull();
    expect(curve.points[0].noveltyRate).toBeNull();
    expect(curve.points[0].rateState).toBe('BASELINE_UNKNOWN');
    expect(curve.arithmeticViolations).toEqual([]);
  });

  it('o baseline entra na aritmética também para jornadas e regras', () => {
    const s = sample({
      canonicalInventoryBaseline: 4,
      canonicalJourneyInventoryBaseline: 7,
      canonicalBusinessRuleInventoryBaseline: 9,
      benchmarks: [
        benchmark({
          id: 'b1',
          order: 1,
          previousInventorySize: 4,
          previousJourneyInventorySize: 7,
          previousBusinessRuleInventorySize: 9,
          novelty: novelty({ newCapabilities: ['c1'], newJourneys: ['j1'], newBusinessRules: ['r1'] }),
        }),
      ],
    });
    expect(buildInventoryCurve({ sample: s, dimension: 'capabilities' }).inventorySize).toBe(5);
    expect(buildInventoryCurve({ sample: s, dimension: 'journeys' }).inventorySize).toBe(8);
    expect(buildInventoryCurve({ sample: s, dimension: 'businessRules' }).inventorySize).toBe(10);
  });
});

// ── §9 DENOMINADORES INDEPENDENTES ────────────────────────────────────────

describe('§9 cada dimensão usa o PRÓPRIO denominador', () => {
  it('JORNADA não é medida em unidades de capability', () => {
    const s = sample({
      canonicalInventoryBaseline: 1000,
      canonicalJourneyInventoryBaseline: 10,
      benchmarks: [
        benchmark({
          id: 'b1',
          order: 1,
          previousInventorySize: 1000,
          previousJourneyInventorySize: 10,
          novelty: novelty({ newJourneys: ['j1', 'j2'] }),
        }),
      ],
    });
    const journeys = buildInventoryCurve({ sample: s, dimension: 'journeys' });
    const capability = buildInventoryCurve({ sample: s, dimension: 'capabilities' });

    // 2 jornadas novas sobre 10 jornadas = 0,2 — e não 2/1000 = 0,002.
    expect(journeys.points[0].previousInventorySize).toBe(10);
    expect(journeys.points[0].noveltyRate).toBe(0.2);
    // A dimensão de capabilities NÃO enxerga novidade de jornada.
    expect(capability.points[0].newItems).toBe(0);
  });

  it('REGRA DE NEGÓCIO também tem denominador próprio', () => {
    const s = sample({
      canonicalInventoryBaseline: 1000,
      canonicalBusinessRuleInventoryBaseline: 4,
      benchmarks: [
        benchmark({
          id: 'b1',
          order: 1,
          previousInventorySize: 1000,
          previousBusinessRuleInventorySize: 4,
          novelty: novelty({ newBusinessRules: ['r1', 'r2'] }),
        }),
      ],
    });
    const rules = buildInventoryCurve({ sample: s, dimension: 'businessRules' });
    expect(rules.points[0].noveltyRate).toBe(0.5);
  });

  it('novidade de jornada acima do threshold derruba o gate de jornadas', () => {
    const s = sample({
      canonicalJourneyInventoryBaseline: 10,
      benchmarks: [
        benchmark({ id: 'b1', order: 1, previousJourneyInventorySize: 10, novelty: novelty({ newJourneys: ['j1', 'j2', 'j3'] }) }),
      ],
    });
    const saturation = evaluateSaturation({ sample: s, policy: POLICY });
    // 3/10 = 0,3 > 0,05
    expect(saturation.journey.status).toBe('FAIL');
  });
});

// ── §10 BASELINE AUSENTE = NÃO MENSURÁVEL ─────────────────────────────────

/**
 * Janela de saturação completa (saturationWindow = 2) com capabilities
 * mensuráveis, para isolar a dimensão em teste.
 */
function measurableDiscovery() {
  return [
    benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', previousInventorySize: 5 }),
    benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', previousInventorySize: 5, dimensions: { marketArchetype: 'a2', geography: 'US' } }),
  ];
}

describe('§10 ausência de baseline é declarada, não silenciada', () => {
  it('sem baseline de jornadas o gate de jornadas NÃO passa silenciosamente', () => {
    const s = sample({
      canonicalInventoryBaseline: 5,
      canonicalJourneyInventoryBaseline: null,
      benchmarks: measurableDiscovery(),
    });
    const saturation = evaluateSaturation({ sample: s, policy: POLICY });

    // A janela está completa: o único motivo possível é a ausência de baseline.
    expect(saturation.journey.insufficientWindow).toBe(false);
    expect(saturation.journey.status).toBe('NOT_MEASURABLE');
    expect(saturation.journey.violations.map((v) => v.reason)).toContain('journey_novelty_rate_baseline_unknown');
    expect(saturation.journey.rateState).toBe('BASELINE_UNKNOWN');
    // Contraste: a dimensão com baseline declarado é mensurável.
    expect(saturation.capability.status).toBe('PASS');
    expect(saturation.capability.rateState).toBe('MEASURED');
  });

  it('sem baseline de regras o gate de regras NÃO passa silenciosamente', () => {
    const s = sample({
      canonicalInventoryBaseline: 5,
      canonicalBusinessRuleInventoryBaseline: null,
      benchmarks: measurableDiscovery(),
    });
    const saturation = evaluateSaturation({ sample: s, policy: POLICY });
    expect(saturation.businessRule.insufficientWindow).toBe(false);
    expect(saturation.businessRule.status).toBe('NOT_MEASURABLE');
    expect(saturation.businessRule.rateState).toBe('BASELINE_UNKNOWN');
  });

  it('dimensão não mensurável impede certificação', () => {
    const s = sample({
      canonicalJourneyInventoryBaseline: null,
      benchmarks: [
        benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', previousInventorySize: 0, novelty: novelty({ newCapabilities: caps(10) }) }),
        benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', previousInventorySize: 10, dimensions: { marketArchetype: 'a2', geography: 'US' } }),
        benchmark({ id: 'b3', order: 3, archetype: 'a1', independenceGroup: 'g3', previousInventorySize: 10 }),
        benchmark({ id: 'h1', role: 'validation', order: 4, archetype: 'a2', independenceGroup: 'gh', previousInventorySize: 10, dimensions: { marketArchetype: 'a2', geography: 'US' } }),
      ],
    });
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.unmeasuredDimensions).toContain('journeys');
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
    expect(result.certifiable).toBe(false);
  });
});

// ── §11 DENOMINADOR ZERO ──────────────────────────────────────────────────

describe('§11 denominador zero é determinístico', () => {
  it('null NÃO é lido como 0', () => {
    const s = sample({
      canonicalInventoryBaseline: 0,
      benchmarks: [benchmark({ id: 'b1', order: 1, previousInventorySize: null, novelty: novelty({ newCapabilities: ['c1', 'c2'] }) })],
    });
    const curve = buildInventoryCurve({ sample: s, dimension: 'capabilities' });
    expect(curve.points[0].previousInventorySizeState).toBe('FROM_CURVE');
    expect(curve.points[0].previousInventorySize).toBe(0);
    expect(curve.points[0].noveltyRate).toBeNull();
    expect(curve.points[0].rateState).toBe('NOT_MEASURABLE_ZERO_DENOMINATOR');
  });

  it('nenhuma taxa inventada: sem NaN, sem Infinity, sem 1 artificial', () => {
    const s = sample({
      canonicalInventoryBaseline: 0,
      benchmarks: [
        benchmark({ id: 'b1', order: 1, previousInventorySize: null, novelty: novelty({ newCapabilities: ['c1', 'c2'] }) }),
      ],
    });
    const curve = buildInventoryCurve({ sample: s, dimension: 'capabilities' });
    const rate = curve.points[0].noveltyRate;
    expect(rate).toBeNull();
    expect(rate).not.toBe(1);
    expect(Number.isFinite(rate)).toBe(false);

    // O mesmo vale para o holdout: 2 capacidades novas sobre base zero não
    // podem virar "100% de novidade" (o código antigo devolvia 1).
    const holdoutSample = sample({
      canonicalInventoryBaseline: 0,
      benchmarks: [
        benchmark({ id: 'b1', order: 1 }),
        benchmark({ id: 'h1', role: 'validation', order: 2, archetype: 'a2', independenceGroup: 'gh', previousInventorySize: null, novelty: novelty({ newCapabilities: ['c1', 'c2'] }) }),
      ],
    });
    const holdout = evaluateHoldout({ sample: holdoutSample, policy: POLICY });
    expect(holdout.noncriticalNoveltyRate).toBeNull();
    expect(holdout.rateState).toBe('NOT_MEASURABLE_ZERO_DENOMINATOR');
    expect(holdout.status).not.toBe('PASS');
  });

  it('nenhum número do resultado é não finito', () => {
    const s = sample({
      canonicalInventoryBaseline: 0,
      benchmarks: [
        benchmark({ id: 'b1', order: 1, previousInventorySize: null, novelty: novelty({ newCapabilities: ['c1'] }) }),
        benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', previousInventorySize: null, dimensions: { marketArchetype: 'a2', geography: 'US' } }),
        benchmark({ id: 'b3', order: 3, archetype: 'a1', independenceGroup: 'g3', previousInventorySize: null }),
        benchmark({ id: 'h1', role: 'validation', order: 4, archetype: 'a2', independenceGroup: 'gh', previousInventorySize: null, dimensions: { marketArchetype: 'a2', geography: 'US' } }),
      ],
    });
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    const offenders = [];
    const walk = (value, trail) => {
      if (typeof value === 'number' && !Number.isFinite(value)) offenders.push(trail);
      else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${trail}[${i}]`));
      else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, `${trail}.${k}`));
    };
    walk(result, 'result');
    expect(offenders).toEqual([]);
  });
});

// ── §12/§13 TRÊS CURVAS + HOLDOUT EM ESTÁGIOS ─────────────────────────────

describe('§12/§13 três curvas independentes e holdout em estágios', () => {
  it('o resultado expõe as três curvas com os campos exigidos', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, previousInventorySize: 0, novelty: novelty({ newCapabilities: ['c1'], newJourneys: ['j1'], newBusinessRules: ['r1'] }) }),
      ],
    });
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });

    expect(Object.keys(result.inventoryCurves).sort()).toEqual(['businessRules', 'capabilities', 'journeys']);
    for (const dimension of ['capabilities', 'journeys', 'businessRules']) {
      const curve = result.inventoryCurves[dimension];
      expect(curve.dimension).toBe(dimension);
      const point = curve.points[0];
      for (const field of ['previousInventorySize', 'newItems', 'newRequiredItems', 'newCriticalItems', 'noveltyRate', 'cumulativeInventorySize']) {
        expect(Object.prototype.hasOwnProperty.call(point, field)).toBe(true);
      }
      expect(point.newItems).toBe(1);
    }
  });

  it('o holdout tem curva própria por dimensão', () => {
    const s = sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, previousInventorySize: 0, novelty: novelty({ newCapabilities: caps(5) }) }),
        benchmark({ id: 'h1', role: 'validation', order: 2, archetype: 'a2', independenceGroup: 'gh', previousInventorySize: 5, novelty: novelty({ newJourneys: ['j1'] }) }),
      ],
    });
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });

    expect(result.holdoutCurves.capabilities.points.map((p) => p.benchmarkId)).toEqual(['h1']);
    expect(result.holdoutCurves.capabilities.points[0].previousInventorySize).toBe(5);
    expect(result.holdoutCurves.journeys.points[0].previousInventorySize).toBe(10);
    expect(result.holdoutCurves.journeys.points[0].newItems).toBe(1);
  });
});
