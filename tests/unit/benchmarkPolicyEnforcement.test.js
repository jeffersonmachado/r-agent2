'use strict';

/**
 * MISSÃO CORRETIVA §5/§6/§7 — ENFORCEMENT REAL DA POLICY.
 *
 * §5: campo normativo sem consumidor é fail-open silencioso.
 * §6: `minimumDistinctIndependenceGroups` existia na policy e não era lido —
 *     white-label / produto irmão somavam como diversidade independente.
 * §7: `maximumBenchmarkReviewAgeDays` era calculado (`maxReviewAgeMs`) e NUNCA
 *     usado: a idade da revisão era comparada apenas contra `maximumSourceAgeDays`
 *     (540), então a policy MAIS RESTRITA (365) não tinha efeito.
 */

const fs = require('fs');
const path = require('path');

const engine = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
const { SAMPLE_STATES, evaluateSampleSufficiency, evaluateFreshness, evaluateDiversity } = engine;

const REPO_ROOT = path.join(__dirname, '..', '..');
const POLICY = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json'), 'utf8'),
);
const ENGINE_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, 'qa', 'benchmarks', 'benchmarkSufficiencyEngine.js'),
  'utf8',
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
    canonicalInventoryBaseline: 100,
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

function healthySample() {
  return sample({
    benchmarks: [
      benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', previousInventorySize: 0, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty({ newCapabilities: caps(100) }) }),
      benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
      benchmark({ id: 'b3', order: 3, archetype: 'a1', independenceGroup: 'g3', dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
      benchmark({ id: 'h1', role: 'validation', order: 4, archetype: 'a2', independenceGroup: 'gh', dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
    ],
  });
}

// ── §5 FIELD WITHOUT ENFORCEMENT ──────────────────────────────────────────

describe('§5 policy sem enforcement = 0', () => {
  const META = [
    '_description', 'version', 'rationale', 'sourceTiers', 'dimensions',
    'criticalityMethodology', 'blockingGates',
  ];

  it('todo campo normativo da policy tem consumidor no engine', () => {
    const normative = Object.keys(POLICY).filter((k) => !META.includes(k));
    // O engine consome campos diretamente (`policy.x`) ou pela registry de
    // dimensões, que referencia o nome do campo como literal — as duas formas
    // provam consumo; nenhuma delas presente prova ausência de consumidor.
    const consumed = (key) => ENGINE_SOURCE.includes(`policy.${key}`)
      || ENGINE_SOURCE.includes(`'${key}'`)
      || ENGINE_SOURCE.includes(`"${key}"`);
    const unenforced = normative.filter((key) => !consumed(key));
    expect(unenforced).toEqual([]);
  });

  it('controla o próprio teste: um campo fictício seria detectado', () => {
    const normative = Object.keys({ ...POLICY, campoInexistente: 1 }).filter((k) => !META.includes(k));
    const consumed = (key) => ENGINE_SOURCE.includes(`policy.${key}`)
      || ENGINE_SOURCE.includes(`'${key}'`)
      || ENGINE_SOURCE.includes(`"${key}"`);
    const unenforced = normative.filter((key) => !consumed(key));
    expect(unenforced).toEqual(['campoInexistente']);
  });
});

// ── §6 MINIMUM DISTINCT INDEPENDENCE GROUPS ───────────────────────────────

describe('§6 diversidade de independência não se satisfaz com clone', () => {
  function cloneSample() {
    // Três benchmarks com independenceGroup DIFERENTE (parece diversidade) mas
    // dois declarados como cópias do primeiro (white-label / mesmo backend).
    return sample({
      benchmarks: [
        benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', previousInventorySize: 0, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty({ newCapabilities: caps(100) }) }),
        benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', cloneOf: 'b1', dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
        benchmark({ id: 'b3', order: 3, archetype: 'a1', independenceGroup: 'g3', cloneOf: 'b1', dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
        benchmark({ id: 'h1', role: 'validation', order: 4, archetype: 'a2', independenceGroup: 'gh', dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
      ],
    });
  }

  it('grupos efetivos (clone-colapsados) abaixo do mínimo reproduzem violação', () => {
    const policy = { ...POLICY, maximumCloneShare: 1 };
    const result = evaluateDiversity({ sample: cloneSample(), policy });
    expect(result.violations.map((v) => v.reason)).toContain('independent_groups_below_minimum');
  });

  it('amostra com grupos reais distintos não dispara a violação', () => {
    const policy = { ...POLICY, maximumCloneShare: 1 };
    const result = evaluateDiversity({ sample: healthySample(), policy });
    expect(result.violations.map((v) => v.reason)).not.toContain('independent_groups_below_minimum');
  });

  it('clone disfarçado de diversidade NÃO certifica', () => {
    const result = evaluateSampleSufficiency({ sample: cloneSample(), policy: POLICY, now: NOW });
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
    expect(result.certifiable).toBe(false);
  });

  it('adversarial: o bloqueio vem do próprio gate de diversidade, isolado', () => {
    // Neutraliza os outros limites de concentração para provar que a única
    // causa possível é `minimumDistinctIndependenceGroups`.
    const policy = {
      ...POLICY,
      maximumCloneShare: 1,
      maximumSingleArchetypeShare: 1,
      maximumSingleCountryShare: 1,
      minimumDistinctArchetypes: 0,
    };
    const result = evaluateSampleSufficiency({ sample: cloneSample(), policy, now: NOW });
    const gate = result.gates.benchmarkDiversity;
    expect(gate.status).toBe('FAIL');
    expect(gate.violations.map((v) => v.reason)).toContain('independent_groups_below_minimum');
    expect(result.blocking.map((b) => b.gate)).toContain('benchmarkDiversity');
    expect(result.certifiable).toBe(false);
  });

  it('adversarial: a mesma amostra com clones removidos certifica pelo gate de diversidade', () => {
    const policy = {
      ...POLICY,
      maximumCloneShare: 1,
      maximumSingleArchetypeShare: 1,
      maximumSingleCountryShare: 1,
      minimumDistinctArchetypes: 0,
    };
    const result = evaluateSampleSufficiency({ sample: healthySample(), policy, now: NOW });
    const gate = result.gates.benchmarkDiversity;
    expect(gate.status).toBe('PASS');
  });
});

// ── §7 FRESHNESS REAL ─────────────────────────────────────────────────────

describe('§7 maximumBenchmarkReviewAgeDays tem efeito', () => {
  const policy = { ...POLICY, maximumSourceAgeDays: 100000, maximumBenchmarkReviewAgeDays: 365 };

  function sampleWithReviewAge(days) {
    const researchedAt = new Date(NOW.getTime() - days * 86400000).toISOString();
    return sample({
      benchmarks: [
        benchmark({ id: 'b1', archetype: 'a1', independenceGroup: 'g1', freshness: { researchedAt, nextReviewAt: '2099-01-01', status: 'FRESH' } }),
        benchmark({ id: 'b2', archetype: 'a2', independenceGroup: 'g2', freshness: { researchedAt, nextReviewAt: '2099-01-01', status: 'FRESH' } }),
      ],
    });
  }

  it('364 dias → FRESH', () => {
    const result = evaluateFreshness({ sample: sampleWithReviewAge(364), policy, now: NOW });
    expect(result.status).toBe('PASS');
    expect(result.items.every((i) => i.status === 'FRESH')).toBe(true);
  });

  it('365 dias → limite inclusivo (não reprova)', () => {
    const result = evaluateFreshness({ sample: sampleWithReviewAge(365), policy, now: NOW });
    expect(result.status).toBe('PASS');
  });

  it('366 dias → STALE por idade de revisão da policy', () => {
    const result = evaluateFreshness({ sample: sampleWithReviewAge(366), policy, now: NOW });
    expect(result.status).toBe('FAIL');
    expect(result.violations.map((v) => v.reason)).toContain('review_age_exceeded_policy');
  });

  it('a review age é comparada contra a policy, não contra o source age', () => {
    // source age permissivo (100000 dias) e review 366 dias: se o limite de
    // revisão não for aplicado, o resultado seria PASS (bug §7).
    const result = evaluateFreshness({ sample: sampleWithReviewAge(366), policy, now: NOW });
    expect(result.status).toBe('FAIL');
  });
});
