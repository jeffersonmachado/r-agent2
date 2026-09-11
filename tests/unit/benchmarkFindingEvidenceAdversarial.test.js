'use strict';

/**
 * EVIDENCE OBRIGATÓRIA PARA TODA DESCOBERTA + ANTI-GAMING DE DENOMINADOR
 *
 * GAP: a rastreabilidade de evidence existia apenas para findings CRÍTICOS.
 * Uma capability não crítica sem evidence também altera o inventário — logo
 * altera denominador, tamanho do inventário, novelty rate e saturação. Deixar
 * esse caminho aberto permitia manipular o resultado final sem precisar
 * mentir sobre nenhum item crítico.
 *
 * Cenários adversarialmente exigidos (§6, §7, §8, §9, §10, §11, §47):
 *  1. 20 capabilities não críticas SEM evidence → INVALID_FINDINGS, não suficiente.
 *  2. As mesmas 20 capabilities COM evidence válida → participam do inventário.
 *  3. Homepage oficial genérica não prova um lote arbitrário de capabilities.
 *  4. Journey/regra externa precisa de cadeia SourceRef → EvidenceRef.
 *  5. RAP_DERIVED explícito é aceito com proveniência; RAP_DERIVED implícito não.
 */

const fs = require('fs');
const path = require('path');

const engine = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
const {
  evaluateFindingEvidence,
  evaluateSampleSufficiency,
  SAMPLE_STATES,
  SOURCE_VERIFICATION_STATES,
} = engine;

const REPO_ROOT = path.join(__dirname, '..', '..');
const POLICY = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json'), 'utf8'));
const NOW = new Date('2026-09-11T12:00:00.000Z');
const OFFICIAL_SOURCE = {
  id: 's1', tier: 2, url: 'https://oficial/features', retrievedAt: '2026-09-01', verified: true, httpStatus: 200,
};

function novelty(overrides = {}) {
  return { ...engine.emptyNovelty(), ...overrides };
}

function finding(id, extra = {}) {
  return { id, sourceRef: 's1', evidenceRef: `ev-${id}`, ...extra };
}

function benchmark(overrides = {}) {
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
    sources: [OFFICIAL_SOURCE],
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
    canonicalJourneyInventoryBaseline: 10,
    canonicalBusinessRuleInventoryBaseline: 10,
    archetypes: [{ id: 'a1', importance: 'REQUIRED', status: 'ACTIVE' }],
    marketScarcityExceptions: [],
    benchmarks: [],
    evidence: [],
    criticalityRegistry: {},
    criticalityOverrides: [],
    unclassifiedCriticalCapabilities: [],
    unclassifiedCriticalJourneys: [],
    unclassifiedCriticalRules: [],
    holdout: null,
    ...overrides,
  };
}

/** `n` capabilities NÃO críticas, com ou sem cadeia de evidence. */
function noncriticalCapabilities(n, { withEvidence = false } = {}) {
  return Array.from({ length: n }, (_, i) => (
    withEvidence
      ? finding(`nc-${i}`)
      : `nc-${i}`
  ));
}

function evidenceFor(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `ev-nc-${i}`,
    sourceRef: 's1',
    kind: 'capability',
    excerpt: `documentação oficial descreve nc-${i}`,
    retrievedAt: '2026-09-01',
  }));
}

describe('§6/§10 ANTI-GAMING: finding sem evidence não entra no inventário', () => {
  it('20 capabilities não críticas sem evidence são INVALID_FINDINGS', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newCapabilities: noncriticalCapabilities(20) }) })],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('FAIL');
    expect(gate.invalidFindings).toHaveLength(20);
    expect(gate.violations.every((v) => String(v.reason).includes('without_'))).toBe(true);
  });

  it('amostra com findings sem evidence não é certificável (denominador não manipulável)', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newCapabilities: noncriticalCapabilities(20) }) })],
    });
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(result.certifiable).toBe(false);
    expect(result.status).not.toBe(SAMPLE_STATES.SUFFICIENT);
    expect(result.criticalBlocking.some((b) => b.gate === 'findingEvidence')).toBe(true);
  });

  it('as MESMAS 20 capabilities com evidence válida participam do inventário', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newCapabilities: noncriticalCapabilities(20, { withEvidence: true }) }) })],
      evidence: evidenceFor(20),
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('PASS');
    expect(gate.invalidFindings).toHaveLength(0);
    expect(gate.validFindings).toHaveLength(20);
  });

  it('evidence declarada mas NÃO RESOLVIDA também invalida o finding', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newCapabilities: [finding('nc-0')] }) })],
      evidence: [],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('FAIL');
    expect(gate.violations.map((v) => v.reason)).toContain('finding_evidence_ref_unresolved');
  });

  it('sourceRef que não resolve para fonte declarada invalida o finding', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newCapabilities: [finding('nc-0', { sourceRef: 'fantasma' })] }) })],
      evidence: evidenceFor(1),
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.violations.map((v) => v.reason)).toContain('finding_source_ref_unresolved');
  });

  it('journey externa exige cadeia completa', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newJourneys: ['j-0'] }) })],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('FAIL');
    expect(gate.invalidFindings.map((f) => f.kind)).toContain('journey');
  });

  it('regra de negócio externa exige cadeia completa', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newBusinessRules: ['r-0'] }) })],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('FAIL');
    expect(gate.invalidFindings.map((f) => f.kind)).toContain('rule');
  });

  it('finding sem classificação de criticalidade não escapa da exigência de evidence', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newCapabilities: ['sem-classificacao'] }) })],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('FAIL');
    expect(gate.invalidFindings[0].criticality).toBe('UNCLASSIFIED');
  });
});

describe('§9 homepage genérica não prova findings arbitrários', () => {
  it('homepage oficial sozinha não sustenta 50 capabilities', () => {
    const s = sample({
      benchmarks: [benchmark({
        sources: [{ id: 'home', tier: 5, url: 'https://concorrente/', retrievedAt: '2026-09-01', verified: true, httpStatus: 200 }],
        novelty: novelty({ newCapabilities: Array.from({ length: 50 }, (_, i) => finding(`c-${i}`, { sourceRef: 'home' })) }),
      })],
      evidence: Array.from({ length: 50 }, (_, i) => ({ id: `ev-c-${i}`, sourceRef: 'home', kind: 'capability' })),
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('FAIL');
    expect(gate.invalidFindings).toHaveLength(50);
    expect(gate.violations.every((v) => v.reason === 'finding_supported_only_by_generic_source')).toBe(true);
  });

  it('fonte específica (documentação/API) sustenta o finding normalmente', () => {
    const s = sample({
      benchmarks: [benchmark({
        sources: [{ id: 'api', tier: 2, url: 'https://concorrente/api/swagger.json', retrievedAt: '2026-09-01', verified: true, httpStatus: 200 }],
        novelty: novelty({ newCapabilities: [finding('c-0', { sourceRef: 'api' })] }),
      })],
      evidence: [{ id: 'ev-c-0', sourceRef: 'api', kind: 'capability' }],
    });
    expect(evaluateFindingEvidence({ sample: s, policy: POLICY }).status).toBe('PASS');
  });

  it('fonte declarada explicitamente como GENERIC nunca comprova finding', () => {
    const s = sample({
      benchmarks: [benchmark({
        sources: [{ id: 'g', tier: 5, url: 'https://concorrente/pagina-inicial', specificity: 'GENERIC', retrievedAt: '2026-09-01', verified: true, httpStatus: 200 }],
        novelty: novelty({ newCapabilities: [finding('c-0', { sourceRef: 'g' })] }),
      })],
      evidence: [{ id: 'ev-c-0', sourceRef: 'g', kind: 'capability' }],
    });
    expect(evaluateFindingEvidence({ sample: s, policy: POLICY }).status).toBe('FAIL');
  });
});

describe('§8 RAP_DERIVED explícito e auditável', () => {
  it('derivação sem proveniência é inválida', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newBusinessRules: [{ id: 'r-0', origin: 'RAP_DERIVED' }] }) })],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('FAIL');
    expect(gate.violations.map((v) => v.reason))
      .toEqual(expect.arrayContaining(['rap_derived_without_derivation_provenance']));
  });

  it('derivação com proveniência completa é aceita e marcada como RAP_DERIVED', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newBusinessRules: [] }) })],
      evidence: [{ id: 'ev-cap-1', sourceRef: 's1', kind: 'capability' }],
      rapDerivations: [{
        id: 'r-0',
        kind: 'rule',
        derivedFrom: ['ev-cap-1'],
        rationale: 'regra operacional implícita no uso de controlar acesso por catraca',
        classifiedBy: 'rap-derivation-process@1',
        inventoryVersion: 'inv-1',
      }],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY, derivations: s.rapDerivations });
    expect(gate.status).toBe('PASS');
    expect(gate.derivedFindings.map((d) => d.id)).toContain('r-0');
  });

  it('derivação que aponta para evidence inexistente é inválida', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newBusinessRules: [] }) })],
      evidence: [],
      rapDerivations: [{
        id: 'r-0',
        kind: 'rule',
        derivedFrom: ['ev-inexistente'],
        rationale: 'x',
        classifiedBy: 'p',
        inventoryVersion: 'inv-1',
      }],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY, derivations: s.rapDerivations });
    expect(gate.status).toBe('FAIL');
    expect(gate.violations.map((v) => v.reason))
      .toContain('rap_derived_source_unresolved');
  });
});

describe('§11 qualidade de fonte por finding (não só no agregado)', () => {
  it('fonte não verificada não comprova finding crítico nem não crítico', () => {
    const s = sample({
      benchmarks: [benchmark({
        sources: [{ id: 's1', tier: 2, url: 'https://oficial/features', verified: false }],
        novelty: novelty({ newCapabilities: [finding('c-0')] }),
      })],
      evidence: [{ id: 'ev-c-0', sourceRef: 's1', kind: 'capability' }],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('FAIL');
    expect(gate.violations.map((v) => v.reason)).toContain('finding_source_not_verified');
    expect(gate.violations[0].verificationState).toBe(SOURCE_VERIFICATION_STATES.NEEDS_VERIFICATION);
  });

  it('finding REQUIRED exige fonte OFICIAL verificada, não secundária', () => {
    const s = sample({
      benchmarks: [benchmark({
        sources: [{ id: 's1', tier: 7, url: 'https://blog-terceiro/review', retrievedAt: '2026-09-01', verified: true, httpStatus: 200 }],
        novelty: novelty({ newRequiredCapabilities: [finding('c-0')] }),
      })],
      evidence: [{ id: 'ev-c-0', sourceRef: 's1', kind: 'capability' }],
    });
    const gate = evaluateFindingEvidence({ sample: s, policy: POLICY });
    expect(gate.status).toBe('FAIL');
    expect(gate.violations.map((v) => v.reason)).toContain('required_finding_source_not_official');
  });
});

describe('§46/§47 estado da amostra com findings inválidos', () => {
  it('findings inválidos produzem INVALID_FINDINGS (não NOT_SATURATED genérico)', () => {
    const s = sample({
      benchmarks: [benchmark({ novelty: novelty({ newCapabilities: noncriticalCapabilities(20) }) })],
    });
    const result = evaluateSampleSufficiency({ sample: s, policy: POLICY, now: NOW });
    expect(SAMPLE_STATES.INVALID_FINDINGS).toBeDefined();
    expect(result.status).toBe(SAMPLE_STATES.INVALID_FINDINGS);
    expect(result.certifiable).toBe(false);
  });
});
