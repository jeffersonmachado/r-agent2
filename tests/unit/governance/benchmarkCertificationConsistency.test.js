'use strict';

/**
 * Casos adversariais do gate BENCHMARK_CERTIFICATION_CONSISTENCY.
 *
 * O gate existe porque o PASS vacuoso medido em 2026-09-19 tinha DUAS formas:
 *
 *  1. DIVERGÊNCIA silenciosa: o engine certificava fitness
 *     (MARKET_SAMPLE_CERTIFIED) enquanto os gates downstream auditavam ZERO
 *     verticais — cada um lia uma fonte diferente de "certificado".
 *  2. VACUIDADE silenciosa: gates PASSando com certifiedSamples=0 e
 *     persistedFindingsChecked=0 — "certificado" sem nenhum achado auditado.
 *
 * Este gate compara os conjuntos PUBLICADOS nos relatórios e falha quando
 * eles divergem ou quando a certificação não tem auditoria real por trás.
 */

const {
  CODES,
  evaluateConsistency,
} = require('../../../scripts/governance/validate-benchmark-certification-consistency');

function semanticReport(overrides = {}) {
  return {
    validator: 'validate-benchmark-semantic-version',
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    certifiedVerticals: ['fitness'],
    auditedCertifiedVerticals: ['fitness'],
    persistedFindingsChecked: 593,
    ...overrides,
  };
}

function corpusReport(overrides = {}) {
  return {
    validator: 'validate-benchmark-persisted-corpus',
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    certifiedVerticals: ['fitness'],
    ...overrides,
  };
}

function phaseModelReport(overrides = {}) {
  return {
    validator: 'validate-benchmark-phase-model',
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    verticals: [
      { vertical: 'fitness', phase: 'SAMPLE_SUFFICIENT' },
      { vertical: 'beauty', phase: 'NOT_STARTED' },
    ],
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    certifiedVerticals: ['fitness'],
    semanticReport: semanticReport(),
    corpusReport: corpusReport(),
    phaseModelReport: phaseModelReport(),
    ...overrides,
  };
}

describe('BENCHMARK_CERTIFICATION_CROSS_CONSISTENCY — um só conjunto de certificadas', () => {
  it('conjuntos coerentes entre autoridade, gates e phase model não violam', () => {
    expect(evaluateConsistency(input())).toEqual([]);
  });

  it('semantic-version auditando conjunto DIFERENTE da autoridade é violação', () => {
    const violations = evaluateConsistency(input({
      semanticReport: semanticReport({ certifiedVerticals: [] }),
    }));
    const codes = violations.map((v) => v.code);
    expect(codes).toContain(CODES.CROSS_CONSISTENCY);
    expect(violations.find((v) => v.code === CODES.CROSS_CONSISTENCY).source).toMatch(/semantic-version/);
  });

  it('persisted-corpus auditando conjunto DIFERENTE da autoridade é violação', () => {
    const violations = evaluateConsistency(input({
      corpusReport: corpusReport({ certifiedVerticals: ['beauty'] }),
    }));
    const violation = violations.find((v) => v.code === CODES.CROSS_CONSISTENCY);
    expect(violation).toBeTruthy();
    expect(violation.source).toMatch(/persisted-corpus/);
  });

  it('phase model ABAIXO de SAMPLE_SUFFICIENT para vertical que a autoridade certifica é violação', () => {
    const violations = evaluateConsistency(input({
      phaseModelReport: phaseModelReport({
        verticals: [{ vertical: 'fitness', phase: 'HOLDOUT' }],
      }),
    }));
    expect(violations.map((v) => v.code)).toContain(CODES.CROSS_CONSISTENCY);
  });

  it('phase model ACIMA de SAMPLE_SUFFICIENT sem certificação da autoridade é violação (certificação por omissão)', () => {
    const violations = evaluateConsistency(input({
      phaseModelReport: phaseModelReport({
        verticals: [
          { vertical: 'fitness', phase: 'CERTIFIED' },
          { vertical: 'beauty', phase: 'CERTIFIED' },
        ],
      }),
    }));
    const violation = violations.find((v) => v.code === CODES.CROSS_CONSISTENCY && v.vertical === 'beauty');
    expect(violation).toBeTruthy();
  });

  it('conjunto vazio coerente é estado honesto (nenhuma vertical certificada ainda)', () => {
    const violations = evaluateConsistency(input({
      certifiedVerticals: [],
      semanticReport: semanticReport({ certifiedVerticals: [], auditedCertifiedVerticals: [], persistedFindingsChecked: 0 }),
      corpusReport: corpusReport({ certifiedVerticals: [] }),
      phaseModelReport: phaseModelReport({
        verticals: [
          { vertical: 'fitness', phase: 'HOLDOUT' },
          { vertical: 'beauty', phase: 'NOT_STARTED' },
        ],
      }),
    }));
    expect(violations).toEqual([]);
  });
});

describe('BENCHMARK_CERTIFICATION_NON_VACUOUS — certificação exige auditoria real', () => {
  it('sufficiency certifica fitness + semantic audita ZERO verticais => FAIL', () => {
    const violations = evaluateConsistency(input({
      semanticReport: semanticReport({ certifiedVerticals: ['fitness'], auditedCertifiedVerticals: [], persistedFindingsChecked: 12 }),
    }));
    expect(violations.map((v) => v.code)).toContain(CODES.NON_VACUOUS);
  });

  it('certifiedVerticals>0 com certifiedSamplesAudited===0 => FAIL (o PASS vacuoso original)', () => {
    const violations = evaluateConsistency(input({
      semanticReport: semanticReport({ auditedCertifiedVerticals: ['fitness'], persistedFindingsChecked: 0 }),
    }));
    const violation = violations.find((v) => v.code === CODES.NON_VACUOUS);
    expect(violation).toBeTruthy();
    expect(violation.detail).toMatch(/persistedFindingsChecked/);
  });

  it('audited != certified (subconjunto) => FAIL', () => {
    const violations = evaluateConsistency(input({
      certifiedVerticals: ['fitness', 'beauty'],
      semanticReport: semanticReport({
        certifiedVerticals: ['beauty', 'fitness'],
        auditedCertifiedVerticals: ['fitness'],
        persistedFindingsChecked: 100,
      }),
      corpusReport: corpusReport({ certifiedVerticals: ['beauty', 'fitness'] }),
      phaseModelReport: phaseModelReport({
        verticals: [
          { vertical: 'fitness', phase: 'CERTIFIED' },
          { vertical: 'beauty', phase: 'SAMPLE_SUFFICIENT' },
        ],
      }),
    }));
    expect(violations.map((v) => v.code)).toContain(CODES.NON_VACUOUS);
  });

  it('sem vertical certificada, a vacuidade NÃO se aplica (ausência de prova não é fraude)', () => {
    const violations = evaluateConsistency(input({
      certifiedVerticals: [],
      semanticReport: semanticReport({ certifiedVerticals: [], auditedCertifiedVerticals: [], persistedFindingsChecked: 0 }),
      corpusReport: corpusReport({ certifiedVerticals: [] }),
    }));
    expect(violations.map((v) => v.code)).not.toContain(CODES.NON_VACUOUS);
  });
});
