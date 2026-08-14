'use strict';

const crypto = require('crypto');
const {
  GENESIS_HASH,
  validateReplayReport,
} = require('../../scripts/governance/validate-replay-governance');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function buildValidReport(now) {
  const replayHash = 'a'.repeat(64);
  const cumulativeHash = sha256(`${GENESIS_HASH}:${replayHash}`);
  return {
    generatedAt: new Date(now).toISOString(),
    pass: true,
    replaySigValid: true,
    enterpriseGovernanceValid: true,
    enterpriseGovernanceReasons: [],
    proofBindingValid: true,
    signatureAuditValid: true,
    signatureAlgorithmsValid: true,
    criticalIssues: 0,
    totalReplays: 1,
    replayRoot: cumulativeHash,
    chain: [{
      index: 0,
      journeyId: 'journey-a',
      replayHash,
      parentReplayHash: GENESIS_HASH,
      cumulativeHash,
      governanceHash: `hmac-sha256:${'b'.repeat(64)}`,
      hasPhysicalHash: true,
    }],
  };
}

describe('validate-replay-governance fail-closed validation', () => {
  const now = Date.parse('2026-08-14T12:00:00.000Z');

  test('accepts a fresh, HMAC-bound and internally consistent report', () => {
    expect(validateReplayReport(buildValidReport(now), { now })).toEqual([]);
  });

  test('rejects legacy reports that omit binding fields and use gov-sha256', () => {
    const report = buildValidReport(now);
    delete report.enterpriseGovernanceValid;
    delete report.proofBindingValid;
    delete report.signatureAuditValid;
    delete report.signatureAlgorithmsValid;
    report.chain[0].governanceHash = `gov-sha256:${'b'.repeat(64)}`;

    const codes = validateReplayReport(report, { now }).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'replay_enterprise_governance_invalid',
      'replay_proof_binding_invalid',
      'replay_signature_audit_invalid',
      'replay_signature_algorithm_unsupported',
      'replay_item_signature_algorithm_unsupported',
    ]));
  });

  test('recomputes cumulative links and rejects chain tampering', () => {
    const report = buildValidReport(now);
    report.chain[0].cumulativeHash = 'c'.repeat(64);
    report.replayRoot = report.chain[0].cumulativeHash;

    const codes = validateReplayReport(report, { now }).map((issue) => issue.code);
    expect(codes).toContain('replay_chain_cumulative_mismatch');
  });

  test('rejects stale reports', () => {
    const report = buildValidReport(now - (8 * 24 * 60 * 60 * 1000));
    const codes = validateReplayReport(report, { now }).map((issue) => issue.code);
    expect(codes).toContain('replay_report_stale');
  });
});
