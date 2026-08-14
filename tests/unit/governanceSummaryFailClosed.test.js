'use strict';

const {
  DIMENSIONS,
  buildGovernanceScore,
} = require('../../scripts/governance/governance-summary');

describe('governance summary fail-closed aggregation', () => {
  const now = Date.parse('2026-08-14T15:00:00.000Z');

  function validReports() {
    const reports = {};
    for (const spec of DIMENSIONS) {
      reports[spec.file] = {
        generatedAt: '2026-08-14T14:30:00.000Z',
        status: spec.accepted[0],
      };
    }
    reports['coverage-gate-report.json'].releaseGate = { decision: 'GO' };
    reports['rag-domain-segregation-report.json'].probes = {
      serviceReachable: true,
      crossDomainLeakage: 0,
      crossTenantLeakage: 0,
      operationalAccessToSystemDomain: 0,
    };
    return reports;
  }

  test('passes only when every source is fresh and semantically complete', () => {
    const reports = validReports();
    const result = buildGovernanceScore({ reader: (file) => reports[file], now });
    expect(result.status).toBe('PASS');
    expect(result.overallGovernance).toBe(100);
    expect(result.issues).toEqual([]);
  });

  test('rejects a RAG PASS whose runtime probes were skipped', () => {
    const reports = validReports();
    reports['rag-domain-segregation-report.json'].probes = {
      serviceReachable: false,
      crossDomainLeakage: 'skipped',
      crossTenantLeakage: 'skipped',
      operationalAccessToSystemDomain: 'skipped',
    };
    const result = buildGovernanceScore({ reader: (file) => reports[file], now });
    expect(result.status).toBe('FAIL');
    expect(result.statuses.ragDomainSegregation).toBe('FAIL');
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'ragDomainSegregation', reason: 'rag_runtime_unreachable' }),
    ]));
  });

  test('rejects stale validation reports even if they say PASS', () => {
    const reports = validReports();
    reports['replay-governance-validation-report.json'].generatedAt = '2026-08-10T12:00:00.000Z';
    const result = buildGovernanceScore({
      reader: (file) => reports[file],
      now,
      maxAgeMs: 24 * 60 * 60 * 1000,
    });
    expect(result.status).toBe('FAIL');
    expect(result.statuses.replayIntegrity).toBe('STALE');
  });

  test('rejects a missing coverage gate report', () => {
    const reports = validReports();
    delete reports['coverage-gate-report.json'];
    const result = buildGovernanceScore({ reader: (file) => reports[file], now });
    expect(result.status).toBe('FAIL');
    expect(result.statuses.coverageGate).toBe('MISSING');
  });
});
