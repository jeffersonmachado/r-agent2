'use strict';

/**
 * HOLDOUT — MÁQUINA DE ESTADOS EXPLÍCITA (adversarial)
 *
 * BUG REPRODUZIDO (RED antes do fix): `evaluateHoldout()` devolvia
 * `status = 'PASS'` para um holdout PRÉ-REGISTRADO e NÃO ANALISADO
 * (`analyzedAt = null`, nenhum finding pesquisado). A causa: sem novelty
 * declarada a taxa de novidade é 0, o 0 fica abaixo do threshold e o gate
 * "passa" por AUSÊNCIA DE TRABALHO — o pior tipo de falso verde, porque premia
 * quem não pesquisou.
 *
 * contrato semântico exigido:
 *   PRE_REGISTERED != ANALYZED
 *   ANALYZED      != PASS
 *   PASS somente após análise real + evidência de análise válida.
 */

const fs = require('fs');
const path = require('path');

const engine = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
const { HOLDOUT_STATES, evaluateHoldout, evaluateSampleSufficiency, SAMPLE_STATES } = engine;

const REPO_ROOT = path.join(__dirname, '..', '..');
const POLICY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json'), 'utf8'));
const NOW = new Date('2026-09-11T12:00:00.000Z');

function novelty(overrides = {}) {
  return { ...engine.emptyNovelty(), ...overrides };
}

/** Benchmark de discovery minimamente completo e verificável. */
function discoveryBenchmark(overrides = {}) {
  return {
    id: 'b1',
    role: 'discovery',
    order: 1,
    archetype: 'a1',
    independenceGroup: 'g1',
    analyzedAt: '2026-09-01T00:00:00.000Z',
    inventoryVersion: 'inv-1',
    researchVersion: 'research-1',
    previousInventorySize: 100,
    novelty: novelty(),
    sources: [{
      id: 's1', tier: 2, url: 'https://oficial/features', retrievedAt: '2026-09-01', verified: true, httpStatus: 200,
    }],
    freshness: { researchedAt: '2026-09-01', nextReviewAt: '2027-03-01', status: 'FRESH' },
    dimensions: { marketArchetype: 'a1', geography: 'BR' },
    ...overrides,
  };
}

/**
 * Holdout minimamente completo: PRÉ-REGISTRADO, com evidência de análise
 * disponível. `analysisEvidencePresent: false` remove deliberadamente os campos
 * de evidência de análise para exercitar o estado de análise incompleta.
 */
function validationBenchmark({ analysisEvidencePresent = true, ...overrides } = {}) {
  const base = {
    id: 'h1',
    role: 'validation',
    order: 2,
    archetype: 'a2',
    independenceGroup: 'gh',
    analyzedAt: '2026-09-05T00:00:00.000Z',
    inventoryVersion: 'inv-1',
    previousInventorySize: 100,
    novelty: novelty(),
    sources: [{
      id: 'sh', tier: 2, url: 'https://holdout/features', retrievedAt: '2026-09-05', verified: true, httpStatus: 200,
    }],
    freshness: { researchedAt: '2026-09-05', nextReviewAt: '2027-03-05', status: 'FRESH' },
    dimensions: { marketArchetype: 'a2', geography: 'US' },
    researchVersion: 'research-h1',
    // §5 inventário de findings pesquisados + mapeamento de arquétipo.
    findingsInventory: [],
    marketArchetypeMapping: { archetype: 'a2', rationale: 'box de treino funcional', evidence: 'https://holdout/features' },
  };
  if (!analysisEvidencePresent) {
    delete base.researchVersion;
    delete base.findingsInventory;
    delete base.marketArchetypeMapping;
  }
  return { ...base, ...overrides };
}

function sample(overrides = {}) {
  return {
    vertical: 'test',
    sampleVersion: 'test-v1',
    inventoryVersion: 'inv-1',
    canonicalInventoryBaseline: 100,
    canonicalJourneyInventoryBaseline: 10,
    canonicalBusinessRuleInventoryBaseline: 10,
    archetypes: [
      { id: 'a1', importance: 'REQUIRED', status: 'ACTIVE' },
      { id: 'a2', importance: 'REQUIRED', status: 'ACTIVE' },
    ],
    marketScarcityExceptions: [],
    benchmarks: [],
    evidence: [],
    criticalityRegistry: {},
    criticalityOverrides: [],
    unclassifiedCriticalCapabilities: [],
    unclassifiedCriticalJourneys: [],
    unclassifiedCriticalRules: [],
    holdout: {
      benchmarkId: 'h1',
      selectedAsHoldoutAt: '2026-08-01T00:00:00.000Z',
      selectionReason: 'pré-registrado antes da pesquisa profunda',
      selectionEvidence: 'archetype a2 selecionado por distância',
      marketArchetype: 'a2',
      inventoryVersion: 'inv-1',
    },
    ...overrides,
  };
}

function sampleWithHoldout(holdoutOverrides = {}, { analysisEvidencePresent = true } = {}) {
  return sample({
    benchmarks: [
      discoveryBenchmark(),
      validationBenchmark({ analysisEvidencePresent, ...holdoutOverrides }),
    ],
  });
}

describe('holdout — máquina de estados (§3, §4, §5)', () => {
  it('GAP §3: holdout PRÉ-REGISTRADO e NÃO ANALISADO nunca é PASS', () => {
    const s = sampleWithHoldout({ analyzedAt: null });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).not.toBe('PASS');
    expect(result.holdoutState).toBe(HOLDOUT_STATES.NOT_ANALYZED);
    expect(result.analyzedAt).toBeNull();
    expect(result.violations.map((v) => v.reason)).toContain('holdout_not_analyzed');
  });

  it('GAP §3: análise ausente derruba a certificação da amostra', () => {
    const s = sampleWithHoldout({ analyzedAt: null });
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.certifiable).toBe(false);
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
    expect(result.gates.holdoutValidation.status).not.toBe('PASS');
    expect(result.criticalBlocking.some((b) => b.gate === 'holdoutValidation')).toBe(true);
  });

  it('GAP §3: novelty vazia por ausência de pesquisa não vira taxa 0 aprovada', () => {
    const s = sampleWithHoldout({ analyzedAt: null, novelty: novelty() });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).toBe('HOLDOUT_NOT_ANALYZED');
    expect(result.certifiable).toBeUndefined();
  });

  it('§5: análise declarada SEM evidência de análise é NOT_MEASURABLE, não PASS', () => {
    const s = sampleWithHoldout({}, { analysisEvidencePresent: false });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).not.toBe('PASS');
    expect(result.holdoutState).toBe(HOLDOUT_STATES.ANALYSIS_EVIDENCE_INCOMPLETE);
    expect(result.violations.map((v) => v.reason))
      .toEqual(expect.arrayContaining(['holdout_analysis_evidence_incomplete']));
    const sampleResult = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(sampleResult.certifiable).toBe(false);
  });

  it('§5: holdout sem source evidence é NOT_MEASURABLE', () => {
    const s = sampleWithHoldout({ sources: [] });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).not.toBe('PASS');
    expect(result.violations.map((v) => v.reason)).toContain('holdout_without_source_evidence');
  });

  it('§5: holdout sem independence group é NOT_MEASURABLE', () => {
    const s = sampleWithHoldout({ independenceGroup: null, cloneOf: null, baseProduct: null });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).not.toBe('PASS');
    expect(result.violations.map((v) => v.reason)).toContain('holdout_without_independence_group');
  });

  it('§5: holdout sem mapeamento de arquétipo de mercado é NOT_MEASURABLE', () => {
    const s = sampleWithHoldout({ archetype: null, marketArchetypeMapping: null });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).not.toBe('PASS');
    expect(result.violations.map((v) => v.reason)).toContain('holdout_without_market_archetype_mapping');
  });

  it('PASS exige análise real + evidência válida + dentro da política', () => {
    const result = evaluateHoldout({ sample: sampleWithHoldout({}), policy: POLICY });
    expect(result.status).toBe('PASS');
    expect(result.holdoutState).toBe(HOLDOUT_STATES.PASS);
    expect(result.analyzedAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('ANALYZED != PASS: análise válida com novidade crítica nova é FAIL', () => {
    const s = sampleWithHoldout({
      novelty: novelty({ newCriticalCapabilities: [{ id: 'cap-x', required: true, sourceRef: 'sh', evidenceRef: 'e1' }] }),
    });
    s.evidence = [{ id: 'e1' }];
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).toBe('FAIL');
    expect(result.holdoutState).toBe(HOLDOUT_STATES.FAIL);
    expect(result.analyzedAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('análise em instante inválido não é tratada como analisada', () => {
    const s = sampleWithHoldout({ analyzedAt: 'não é data' });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).not.toBe('PASS');
    expect(result.violations.map((v) => v.reason)).toContain('holdout_analyzed_at_invalid');
  });

  it('holdout não pré-registrado permanece FAIL', () => {
    const s = sample({ holdout: null });
    const result = evaluateHoldout({ sample: s, policy: POLICY });
    expect(result.status).toBe('FAIL');
    expect(result.holdoutState).toBe(HOLDOUT_STATES.NOT_REGISTERED);
  });
});

describe('taxonomia de estados do holdout é explícita e ordenada (§4)', () => {
  it('expõe estados distintos e não colapsa pré-registro em análise', () => {
    const states = Object.values(HOLDOUT_STATES);
    expect(new Set(states).size).toBe(states.length);
    expect(HOLDOUT_STATES.PRE_REGISTERED).not.toBe(HOLDOUT_STATES.ANALYZED);
    expect(HOLDOUT_STATES.ANALYZED).not.toBe(HOLDOUT_STATES.PASS);
    expect(HOLDOUT_STATES.NOT_ANALYZED).not.toBe(HOLDOUT_STATES.PASS);
    expect(HOLDOUT_STATES.NOT_REGISTERED).not.toBe(HOLDOUT_STATES.PRE_REGISTERED);
  });

  it('todo resultado de evaluateHoldout carrega holdoutState da taxonomia', () => {
    const known = new Set(Object.values(HOLDOUT_STATES));
    const cases = [
      sample({ holdout: null }),
      sampleWithHoldout({ analyzedAt: null }),
      sampleWithHoldout({}),
      sampleWithHoldout({ novelty: novelty({ newCriticalJourneys: ['j-x'] }) }),
    ];
    for (const s of cases) {
      const result = evaluateHoldout({ sample: s, policy: POLICY });
      expect(known.has(result.holdoutState)).toBe(true);
    }
  });
});
