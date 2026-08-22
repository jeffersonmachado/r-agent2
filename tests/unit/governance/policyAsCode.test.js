'use strict';

const policy = require('../../../governance/policy-as-code');

describe('RAP constitutional policy-as-code', () => {
  test('blocks missing tenant and implicit system execution', () => {
    expect(() => policy.requireTenant()).toThrow('TENANT_REQUIRED');
    expect(() => policy.requireTenant('system')).toThrow('TENANT_REQUIRED');
    expect(policy.requireTenant('tenant-a')).toBe('tenant-a');
  });
  test('blocks unauthorized tool and unvalidated business outcome', () => {
    expect(() => policy.requirePermission([], 'tickets:write')).toThrow('TOOL_PERMISSION_REQUIRED');
    expect(() => policy.requireOutcomeContract({ status: 'SUCCESS' })).toThrow('OUTCOME_CONTRACT_REQUIRED');
  });
  test('blocks claims without evidence and synthetic producers', () => {
    expect(() => policy.requireEvidence({})).toThrow('EVIDENCE_REQUIRED');
    expect(() => policy.rejectSyntheticProducer('synthetic:generator')).toThrow('SYNTHETIC_CERTIFICATION_EVIDENCE');
  });
  test('blocks readiness and artifact lineage violations', () => {
    expect(() => policy.requireAutonomousReady({ dimensionsBelow10: 1, mandatoryGateFailures: 0, openGaps: 0, openBlockers: 0 })).toThrow('AUTONOMOUS_READY_BLOCKED');
    expect(() => policy.requireArtifactLineage({ runId: 'run-1' })).toThrow('ARTIFACT_LINEAGE_REQUIRED');
    expect(policy.requireAutonomousReady({ dimensionsBelow10: 0, mandatoryGateFailures: 0, openGaps: 0, openBlockers: 0 })).toBe('AUTONOMOUS_READY');
  });
});