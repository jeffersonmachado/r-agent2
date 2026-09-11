'use strict';

/**
 * MISSÃO CORRETIVA §2–§4 — BLOCKING GATES DO BENCHMARK SAMPLE SUFFICIENCY.
 *
 * BUG REPRODUZIDO: `governanceFloor` calculava FAIL
 * (`independent_discovery_benchmarks_below_floor`) e mesmo assim o engine
 * devolvia `SAMPLE_SUFFICIENT` com `certifiable = true`.
 *
 * Causa: a decisão final filtrava os gates por `policy.criticalGates`, e essa
 * lista OMITIA `governanceFloor`. Um gate bloqueante fora da lista deixava de
 * bloquear — a decisão dependia de uma lista editável, não de uma fonte
 * explícita de semântica de bloqueio.
 *
 * Invariante exigido: ANY_BLOCKING_GATE_FAIL → SAMPLE_SUFFICIENT = FALSE.
 */

const fs = require('fs');
const path = require('path');

const engine = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
const { SAMPLE_STATES, evaluateSampleSufficiency } = engine;

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
    // §8 O inventário acumulado é o próprio baseline (100): nenhum benchmark
    // desta fixture acrescenta item.
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
    // §8 O baseline canônico é NÃO-ZERO e entra na aritmética; como nenhum
    // benchmark acrescenta item (amostra saturada), o inventário permanece 100.
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

function caps(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => `cap-${offset + i}`);
}

/**
 * Cenário §3: 2 discovery independentes + 1 holdout, todos os demais gates PASS.
 * (5 benchmarks totais: b1 define o catálogo; b2 e b3 não acrescentam nada.)
 */
function twoIndependentDiscoverySample() {
  return sample({
    benchmarks: [
      benchmark({ id: 'b1', order: 1, archetype: 'a1', independenceGroup: 'g1', previousInventorySize: 100, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
      benchmark({ id: 'b2', order: 2, archetype: 'a2', independenceGroup: 'g2', previousInventorySize: 100, dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
      benchmark({ id: 'b3', order: 3, archetype: 'a1', independenceGroup: 'g2', previousInventorySize: 100, dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
      benchmark({ id: 'h1', role: 'validation', order: 4, archetype: 'a2', independenceGroup: 'gh', previousInventorySize: 100, dimensions: { marketArchetype: 'a2', geography: 'US' }, novelty: novelty() }),
    ],
  });
}

function failingGates(result) {
  return Object.entries(result.gates)
    .filter(([, gate]) => gate.status !== 'PASS')
    .map(([name]) => name)
    .sort();
}

describe('missão corretiva §2/§3 — governance floor bloqueia certificação', () => {
  it('policy declara o floor mínimo de discovery independentes', () => {
    expect(POLICY.minimumIndependentDiscoveryBenchmarks).toBeGreaterThanOrEqual(3);
  });

  it('2 discovery independentes (floor=3) → governanceFloor FAIL, NÃO certificável', () => {
    const s = twoIndependentDiscoverySample();
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });

    // Gate reprovado com o motivo correto.
    expect(result.gates.governanceFloor.status).toBe('FAIL');
    expect(result.gates.governanceFloor.violations.map((v) => v.reason)).toContain(
      'independent_discovery_benchmarks_below_floor',
    );

    // Precondição do cenário §3: nenhum OUTRO gate falha.
    const failing = failingGates(result).filter((name) => name !== 'governanceFloor');
    expect(failing).toEqual([]);

    // Invariante: gate bloqueante reprovado nunca certifica.
    expect(result.blocking.map((b) => b.gate)).toContain('governanceFloor');
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
    expect(result.certifiable).toBe(false);
  });

  it('o floor passa quando há 3 discovery independentes (não é vacuoso)', () => {
    const s = twoIndependentDiscoverySample();
    s.benchmarks.push(
      benchmark({ id: 'b4', order: 4, archetype: 'a1', independenceGroup: 'g3', dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
    );
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.gates.governanceFloor.status).toBe('PASS');
    expect(result.status).toBe(SAMPLE_STATES.SUFFICIENT);
    expect(result.certifiable).toBe(true);
  });
});

describe('missão corretiva §4 — fonte explícita de gates bloqueantes', () => {
  it('todo gate do engine tem semântica de bloqueio explícita (crítico ou information-only)', () => {
    const result = evaluateSampleSufficiency({
      sample: twoIndependentDiscoverySample(),
      policy: POLICY,
      now: NOW,
    });

    const criticalGates = new Set(engine.listCriticalGates());
    const informationOnly = new Set(engine.INFORMATION_ONLY_GATES);

    const undecided = Object.keys(result.gates).filter(
      (name) => !criticalGates.has(name) && !informationOnly.has(name),
    );

    expect(undecided).toEqual([]);
  });

  it('governanceFloor é gate crítico declarado', () => {
    expect(engine.listCriticalGates()).toContain('governanceFloor');
  });

  it('nenhum gate reprovado fica fora da lista de bloqueantes', () => {
    const s = twoIndependentDiscoverySample();
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    const critical = new Set(engine.listCriticalGates());
    const escaped = result.blocking.filter((b) => !critical.has(b.gate)).map((b) => b.gate);
    expect(escaped).toEqual([]);
  });

  it('blocking vazio ⟺ certificável (nada compensa gate reprovado)', () => {
    const s = twoIndependentDiscoverySample();
    s.benchmarks.push(
      benchmark({ id: 'b4', order: 4, archetype: 'a1', independenceGroup: 'g3', dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
    );
    const ok = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(ok.blocking).toEqual([]);
    expect(ok.certifiable).toBe(true);

    const comFloor = twoIndependentDiscoverySample();
    const bad = evaluateSampleSufficiency({ sample: comFloor, policy: POLICY, now: NOW });
    expect(bad.blocking.length).toBeGreaterThan(0);
    expect(bad.certifiable).toBe(false);
  });

  it('freshness reprovado também bloqueia (invariante não é específico do floor)', () => {
    const s = twoIndependentDiscoverySample();
    s.benchmarks.push(
      benchmark({ id: 'b4', order: 4, archetype: 'a1', independenceGroup: 'g3', dimensions: { marketArchetype: 'a1', geography: 'BR' }, novelty: novelty() }),
    );
    // Evidência vencida muito além do limite da policy.
    s.benchmarks[0].freshness = { researchedAt: '2000-01-01', nextReviewAt: '2001-01-01', status: 'FRESH' };

    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.gates.freshness.status).toBe('FAIL');
    expect(result.certifiable).toBe(false);
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
  });

  it('gate marcado information-only não bloqueia certificação', () => {
    expect(engine.INFORMATION_ONLY_GATES).toContain('benchmarkIndependence');
    expect(engine.listCriticalGates()).not.toContain('benchmarkIndependence');
  });

  it('a decisão NÃO depende de lista configurável na policy (fail-safe por omissão)', () => {
    const semLista = { ...POLICY };
    delete semLista.criticalGates;
    const s = twoIndependentDiscoverySample();
    const comLista = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    const semListaResult = evaluateSampleSufficiency({ sample: s, policy: semLista, now: NOW });
    expect(semListaResult.status).toBe(comLista.status);
    expect(semListaResult.certifiable).toBe(false);
  });
});
