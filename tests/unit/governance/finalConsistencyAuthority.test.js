'use strict';

const { buildFinalConsistencyAuthorityChecks, isGo } = require('../../../governance/final-consistency-gate');

const FP = 'c'.repeat(64);
const RUN = {
  runId: 'rap-release-20260821-130000-cccccccc',
  sourceFingerprint: FP,
  startedAt: '2026-08-21T16:00:00.000Z',
  generatedAt: '2026-08-21T16:00:00.000Z',
  status: 'RUNNING',
  artifactType: 'run-context',
  artifactVersion: '1.0.0',
};

function meta(artifactType) {
  return {
    runId: RUN.runId,
    sourceFingerprint: FP,
    generatedAt: '2026-08-21T16:01:00.000Z',
    artifactType,
    artifactVersion: '1.0.0',
  };
}

function documents() {
  return {
    scorecard: {
      ...meta('rap-master-scorecard'),
      dimensions: [{
        id: 'RAP-001', score: 10, target: 10,
        requirements: [{ id: 'r1', mandatory: true, status: 'PASS' }],
        tests: ['t'], runtimeEvidence: ['e'], blockers: [], gaps: [],
      }], blockers: [], gaps: [],
    },
    selfProof: {
      ...meta('self-proving-report'), pass: true, selfProofStatus: 'PASS',
      verifierPassed: true, staleReferencesFound: 0, staleHashesFound: 0,
      selfProofGate: { failedGates: [] },
    },
    tamper: {
      ...meta('tamper-detection-report'), pass: true, decision: 'GO', failedChecks: 0,
      checks: [{ id: 'hash', pass: true }],
    },
    proof: {
      ...meta('final-proof-report'), finalDecision: 'AUTONOMOUS_READY_GO',
      fingerprintStatus: 'FRESH', blockerCount: 0, missingArtifacts: [],
    },
    readiness: {
      ...meta('final-readiness-report'), finalDecision: 'AUTONOMOUS_READY_GO', blockingGaps: [],
    },
    finalGovernance: {
      ...meta('final-governance-report'), finalDecision: 'AUTONOMOUS_READY_GO',
      autonomousReady: true, allChecksPass: true, checks: [{ id: 'authority', pass: true }],
    },
  };
}

describe('Final Consistency — mandatory same-run authority', () => {
  test('all six authority artifacts must PASS in the same run', () => {
    const checks = buildFinalConsistencyAuthorityChecks({ runContext: RUN, ...documents() });
    expect(checks).toHaveLength(6);
    expect(checks.every((check) => check.pass)).toBe(true);
  });

  test.each([
    ['missing scorecard', (docs) => { docs.scorecard = null; }],
    ['readiness NO_GO', (docs) => { docs.readiness.finalDecision = 'NO_GO:BLOCKED'; }],
    ['self proof UNKNOWN', (docs) => { docs.selfProof.selfProofStatus = 'UNKNOWN'; }],
    ['tamper NO_GO', (docs) => { docs.tamper.decision = 'NO_GO'; docs.tamper.pass = false; }],
    ['foreign governance', (docs) => { docs.finalGovernance.runId = 'foreign'; }],
  ])('%s makes final consistency fail', (_label, mutate) => {
    const docs = documents();
    mutate(docs);
    expect(buildFinalConsistencyAuthorityChecks({ runContext: RUN, ...docs }).some((check) => !check.pass)).toBe(true);
  });

  test('unknown strings are not classified as GO by substring', () => {
    expect(isGo('SOMETHING_GO')).toBeNull();
    expect(isGo('UNKNOWN')).toBeNull();
    expect(isGo('AUTONOMOUS_READY_GO')).toBe(true);
    expect(isGo('NO_GO:BLOCKED')).toBe(false);
  });
});
