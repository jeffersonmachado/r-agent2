'use strict';

/**
 * MISSÃO CORRETIVA §14–§16 — RASTREABILIDADE DE EVIDÊNCIA E ESTADO DA FONTE.
 *
 * §14 Toda descoberta CRÍTICA precisa de cadeia completa e resolvível:
 *     Benchmark → External Capability → SourceRef → EvidenceRef.
 * §15 A fonte tem ESTADO DERIVADO (não um booleano solto):
 *     VERIFIED_OFFICIAL | VERIFIED_SECONDARY | NEEDS_VERIFICATION | UNVERIFIED.
 * §16 Achado crítico sustentado apenas por fonte secundária/não verificada NÃO
 *     certifica.
 */

const fs = require('fs');
const path = require('path');

const engine = require('../../qa/benchmarks/benchmarkSufficiencyEngine');
const {
  SOURCE_VERIFICATION_STATES,
  classifySourceVerification,
  evaluateSourceQuality,
  evaluateEvidenceTraceability,
  evaluateSampleSufficiency,
  listCriticalGates,
  GATE_NAMES,
} = engine;

const REPO_ROOT = path.join(__dirname, '..', '..');
const POLICY = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'config', 'benchmark-sufficiency-policy.json'), 'utf8'),
);
const NOW = new Date('2026-09-10T12:00:00.000Z');

function novelty(overrides = {}) {
  return { ...engine.emptyNovelty(), ...overrides };
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
      selectionReason: 'pré-registrado',
      selectionEvidence: 'doc',
      marketArchetype: 'a2',
      inventoryVersion: 'inv-1',
    },
    ...overrides,
  };
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
    previousInventorySize: 100,
    novelty: novelty(),
    sources: [{ tier: 1, id: 'src-doc', url: 'https://oficial/doc', retrievedAt: '2026-09-01', verified: true, httpStatus: 200 }],
    freshness: { researchedAt: '2026-09-01', nextReviewAt: '2027-03-01', status: 'FRESH' },
    dimensions: { marketArchetype: 'a1', geography: 'BR' },
    ...overrides,
  };
}

// ── §15 ESTADO DA FONTE ───────────────────────────────────────────────────

describe('§15 estado de verificação da fonte é derivado, não adivinhado', () => {
  it('documentação oficial verificada é VERIFIED_OFFICIAL', () => {
    expect(classifySourceVerification({ tier: 1, url: 'https://a', verified: true, httpStatus: 200 }, POLICY))
      .toBe(SOURCE_VERIFICATION_STATES.VERIFIED_OFFICIAL);
    expect(classifySourceVerification({ tier: 6, url: 'https://a', verified: true }, POLICY))
      .toBe(SOURCE_VERIFICATION_STATES.VERIFIED_OFFICIAL);
  });

  it('fonte secundária de alta confiança é VERIFIED_SECONDARY', () => {
    expect(classifySourceVerification({ tier: 7, url: 'https://blog', verified: true }, POLICY))
      .toBe(SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY);
  });

  it('URL sem confirmação é NEEDS_VERIFICATION', () => {
    expect(classifySourceVerification({ tier: 1, url: 'https://a' }, POLICY))
      .toBe(SOURCE_VERIFICATION_STATES.NEEDS_VERIFICATION);
    expect(classifySourceVerification({ tier: 1, url: 'https://a', verified: false }, POLICY))
      .toBe(SOURCE_VERIFICATION_STATES.NEEDS_VERIFICATION);
  });

  it('sem URL, ou tier de apoio, é UNVERIFIED', () => {
    expect(classifySourceVerification({ tier: 1, verified: true }, POLICY))
      .toBe(SOURCE_VERIFICATION_STATES.UNVERIFIED);
    expect(classifySourceVerification({ tier: 8, url: 'https://forum', verified: true }, POLICY))
      .toBe(SOURCE_VERIFICATION_STATES.UNVERIFIED);
  });

  it('o limite entre oficial e secundário vem da POLICY, não do código', () => {
    const source = { tier: 6, url: 'https://a', verified: true };
    expect(classifySourceVerification(source, POLICY)).toBe(SOURCE_VERIFICATION_STATES.VERIFIED_OFFICIAL);
    const strict = { ...POLICY, officialSourceTierMax: 5 };
    expect(classifySourceVerification(source, strict)).toBe(SOURCE_VERIFICATION_STATES.VERIFIED_SECONDARY);
  });

  it('benchmark sem nenhuma fonte oficial verificada reprova', () => {
    const s = sample({
      benchmarks: [
        benchmark({ sources: [{ tier: 7, url: 'https://blog', retrievedAt: '2026-09-01', verified: true }] }),
      ],
    });
    const result = evaluateSourceQuality({ sample: s, policy: POLICY });
    expect(result.violations.map((v) => v.reason)).toContain('benchmark_without_verified_official_source');
    expect(result.status).toBe('FAIL');
  });

  it('benchmark com fonte oficial verificada passa e reporta o estado', () => {
    const s = sample({ benchmarks: [benchmark()] });
    const result = evaluateSourceQuality({ sample: s, policy: POLICY });
    expect(result.status).toBe('PASS');
    expect(result.benchmarks[0].verificationState).toBe(SOURCE_VERIFICATION_STATES.VERIFIED_OFFICIAL);
  });
});

// ── §14 RASTREABILIDADE ───────────────────────────────────────────────────

describe('§14 achado crítico exige cadeia Benchmark → Capability → SourceRef → EvidenceRef', () => {
  const criticalItem = (overrides = {}) => ({ id: 'cap-critica', required: true, sourceRef: 'src-doc', evidenceRef: 'ev-1', ...overrides });

  function traceableSample(item) {
    return sample({
      evidence: [{ id: 'ev-1', kind: 'screenshot', ref: 'AI_MEMORY/evidence/ev-1.png', capturedAt: '2026-09-01', sha256: 'a'.repeat(64) }],
      benchmarks: [benchmark({ novelty: novelty({ newCriticalCapabilities: [item] }) })],
    });
  }

  it('cadeia completa e resolvível passa', () => {
    const result = evaluateEvidenceTraceability({ sample: traceableSample(criticalItem()) });
    expect(result.status).toBe('PASS');
    expect(result.violations).toEqual([]);
    expect(result.criticalItems).toHaveLength(1);
  });

  it('sem evidenceRef reprova', () => {
    const result = evaluateEvidenceTraceability({ sample: traceableSample(criticalItem({ evidenceRef: undefined })) });
    expect(result.status).toBe('FAIL');
    expect(result.violations.map((v) => v.reason)).toContain('critical_item_without_evidence_ref');
  });

  it('sem sourceRef reprova', () => {
    const result = evaluateEvidenceTraceability({ sample: traceableSample(criticalItem({ sourceRef: undefined })) });
    expect(result.status).toBe('FAIL');
    expect(result.violations.map((v) => v.reason)).toContain('critical_item_without_source_ref');
  });

  it('sourceRef que não resolve para uma fonte declarada reprova', () => {
    const result = evaluateEvidenceTraceability({ sample: traceableSample(criticalItem({ sourceRef: 'https://inexistente' })) });
    expect(result.status).toBe('FAIL');
    expect(result.violations.map((v) => v.reason)).toContain('critical_item_source_ref_unresolved');
  });

  it('evidenceRef que não resolve para evidência declarada reprova', () => {
    const result = evaluateEvidenceTraceability({ sample: traceableSample(criticalItem({ evidenceRef: 'ev-inexistente' })) });
    expect(result.status).toBe('FAIL');
    expect(result.violations.map((v) => v.reason)).toContain('critical_item_evidence_ref_unresolved');
  });

  it('item crítico em forma de string (sem cadeia) também reprova', () => {
    const result = evaluateEvidenceTraceability({ sample: traceableSample('cap-critica') });
    expect(result.status).toBe('FAIL');
    expect(result.violations.map((v) => v.reason)).toContain('critical_item_without_source_ref');
  });

  it('a rastreabilidade é um gate crítico bloqueante', () => {
    expect(GATE_NAMES).toContain('evidenceTraceability');
    expect(listCriticalGates()).toContain('evidenceTraceability');

    const result = evaluateSampleSufficiency({ sample: traceableSample(criticalItem({ evidenceRef: undefined })), policy: POLICY, now: NOW });
    expect(result.gates.evidenceTraceability.status).toBe('FAIL');
    expect(result.blocking.map((b) => b.gate)).toContain('evidenceTraceability');
    expect(result.certifiable).toBe(false);
  });
});

// ── §16 ACHADO CRÍTICO COM FONTE FRACA ────────────────────────────────────

describe('§16 achado crítico não se sustenta em fonte secundária', () => {
  it('crítico apoiado apenas em fonte secundária reprova', () => {
    const s = sample({
      evidence: [{ id: 'ev-1', kind: 'doc', ref: 'ev-1', capturedAt: '2026-09-01' }],
      benchmarks: [
        benchmark({
          sources: [{ tier: 7, id: 'src-blog', url: 'https://blog', retrievedAt: '2026-09-01', verified: true }],
          novelty: novelty({ newCriticalCapabilities: [{ id: 'cap-critica', required: true, sourceRef: 'src-blog', evidenceRef: 'ev-1' }] }),
        }),
      ],
    });
    const result = evaluateSourceQuality({ sample: s, policy: POLICY });
    expect(result.violations.map((v) => v.reason)).toContain('critical_finding_source_not_verified_official');
  });

  it('crítico apoiado em fonte oficial verificada passa', () => {
    const s = sample({
      evidence: [{ id: 'ev-1', kind: 'doc', ref: 'ev-1', capturedAt: '2026-09-01' }],
      benchmarks: [
        benchmark({
          novelty: novelty({ newCriticalCapabilities: [{ id: 'cap-critica', required: true, sourceRef: 'src-doc', evidenceRef: 'ev-1' }] }),
        }),
      ],
    });
    const result = evaluateSourceQuality({ sample: s, policy: POLICY });
    expect(result.violations.map((v) => v.reason)).not.toContain('critical_finding_source_not_verified_official');
  });
});
