'use strict';

const {
  evaluateRagDomainSegregationReport,
} = require('../../../scripts/governance/validate-coverage-gate');

function completeReport(overrides = {}) {
  return {
    generatedAt: '2026-08-14T12:00:00.000Z',
    status: 'PASS',
    metrics: {
      crossDomainLeakage: 0,
      crossTenantLeakage: 0,
      unclassifiedDocuments: 0,
      incoherentDocuments: 0,
      indexedSecrets: 0,
      operationalAccessToSystemDomain: 0,
      dbChecksFailed: 0,
      runtimeChecksFailed: 0,
      internalTokenMissing: 0,
    },
    probes: {
      serviceReachable: true,
      crossDomainLeakage: 0,
      crossTenantLeakage: 0,
      operationalAccessToSystemDomain: 0,
    },
    ...overrides,
  };
}

describe('evidência de segregação RAG no coverage gate', () => {
  const now = Date.parse('2026-08-14T13:00:00.000Z');

  test('aceita somente relatório PASS fresco com todos os probes executados', () => {
    expect(evaluateRagDomainSegregationReport(completeReport(), { now })).toMatchObject({
      count: 0,
      items: [],
    });
  });

  test('bloqueia relatório ausente', () => {
    expect(evaluateRagDomainSegregationReport(null, { now })).toMatchObject({
      count: 1,
      items: ['rag_report_missing'],
    });
  });

  test('bloqueia runtime inalcançável e probes pulados mesmo com status PASS', () => {
    const result = evaluateRagDomainSegregationReport(completeReport({
      probes: {
        serviceReachable: false,
        crossDomainLeakage: 'skipped',
        crossTenantLeakage: 'skipped',
        operationalAccessToSystemDomain: 'skipped',
      },
    }), { now });

    expect(result.count).toBeGreaterThan(0);
    expect(result.items).toEqual(expect.arrayContaining([
      'rag_runtime_unreachable',
      'crossDomainLeakage=not_executed',
      'crossTenantLeakage=not_executed',
      'operationalAccessToSystemDomain=not_executed',
    ]));
  });

  test('bloqueia evidência vencida e métricas positivas', () => {
    const report = completeReport({
      generatedAt: '2026-08-01T00:00:00.000Z',
      status: 'FAIL',
    });
    report.metrics.crossTenantLeakage = 1;

    const result = evaluateRagDomainSegregationReport(report, { now });
    expect(result.items).toEqual(expect.arrayContaining([
      'rag_report_stale',
      'rag_report_status=FAIL',
      'crossTenantLeakage=1',
    ]));
  });
});
