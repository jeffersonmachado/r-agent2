'use strict';

const operationalReplayValidator = require('../qa/operationalReplayValidator');
const {
  signReplayArtifact,
  validateReplayIntegrity,
} = require('../qa/replayIntegrityService');

function buildReplay(overrides = {}) {
  return {
    replayId: 'replay-integrity-1',
    source: 'qa-waves',
    journeyId: 'fitness_customer_checkin',
    rawStepCount: 1,
    rawScreenshotCount: 2,
    screenshots: [{ id: 'before', data: 'before', timestamp: '2026-05-09T10:00:00.000Z', description: 'before' }],
    pages: ['/operations-dashboard'],
    rawPages: ['/operations-dashboard'],
    beforeSnapshot: { db: { attendance: { count: 0 } } },
    afterSnapshot: { db: { attendance: { count: 1 } } },
    seedEvidence: {
      status: 'ready',
      subjectId: 'subject-1',
      membershipId: 'membership-1',
      credentialId: 'credential-1',
      deviceId: 'device-1',
    },
    operationalSeedStatus: 'ready',
    steps: [{
      id: 'step_submit_checkin',
      actionType: 'checkin_submit',
      semanticContract: {
        stepId: 'step_submit_checkin',
        actionType: 'checkin_submit',
        mutationExpected: true,
      },
      evidenceClassification: 'operational',
      mutationExpected: true,
      screenshotBefore: 'before',
      screenshotAfter: 'after',
      url: '/operations-dashboard',
      networkEvents: [{ type: 'response', method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 }],
      incrementalDiff: { changed: true, details: [{ field: 'db.attendance.count', before: 0, after: 1 }] },
      observedMutations: ['attendance_created'],
      observedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
      mutationLinkage: {
        expectedMutations: ['attendance_created'],
        expectedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
        correlatedBy: 'network_linkage',
      },
      mutationProvenance: [{
        mutation: 'attendance_created',
        valid: true,
        correlatedBy: 'network_linkage',
        originatingStepId: 'step_submit_checkin',
        originatingActionType: 'checkin_submit',
        originatingNetworkEvent: { method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 },
        entityScope: ['attendance', 'access_decision', 'access_event', 'crm_journey'],
        beforeStepSnapshotHash: 'before-hash',
        afterStepSnapshotHash: 'after-hash',
      }],
    }],
    postStateSummary: {
      observedMutations: ['attendance_created'],
      observedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
      mutationProvenance: [{
        mutation: 'attendance_created',
        valid: true,
        correlatedBy: 'network_linkage',
        originatingStepId: 'step_submit_checkin',
        originatingActionType: 'checkin_submit',
        originatingNetworkEvent: { method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 },
        entityScope: ['attendance', 'access_decision', 'access_event', 'crm_journey'],
        beforeStepSnapshotHash: 'before-hash',
        afterStepSnapshotHash: 'after-hash',
      }],
      networkCorrelation: [{ method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 }],
    },
    ...overrides,
  };
}

function sign(replay) {
  const governance = { goNoGo: 'GO', isOperational: true, blockers: [] };
  return signReplayArtifact({ ...replay, governance }, {
    governance,
    generatedAt: '2026-05-09T10:00:00.000Z',
    tenantId: 'QA Waves Smoke',
    environment: { mode: 'prod_like_real_stack' },
    smokeExecutionId: 'smoke-1',
  });
}

describe('QA Waves replay integrity hardening', () => {
  test('originatingActionType != semanticContract.actionType => NO_GO', () => {
    const replay = buildReplay({
      steps: [{
        ...buildReplay().steps[0],
        mutationProvenance: [{ ...buildReplay().steps[0].mutationProvenance[0], originatingActionType: 'submit' }],
      }],
      postStateSummary: {
        ...buildReplay().postStateSummary,
        mutationProvenance: [{ ...buildReplay().postStateSummary.mutationProvenance[0], originatingActionType: 'submit' }],
      },
    });

    const result = operationalReplayValidator.validateOperationalReplay(replay, { journeyId: 'fitness_customer_checkin' });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.map((item) => item.reason)).toContain('originating_action_type_mismatch');
  });

  test('replay integrity validation => PASS', () => {
    const replay = sign(buildReplay());
    const result = validateReplayIntegrity(replay, replay.governance);
    expect(result.valid).toBe(true);
  });

  test('canonical actionType persistence => PASS', () => {
    const replay = sign(buildReplay());
    const step = replay.steps[0];
    expect(step.actionType).toBe('checkin_submit');
    expect(step.semanticContract.actionType).toBe('checkin_submit');
    expect(replay.postStateSummary.mutationProvenance[0].originatingActionType).toBe('checkin_submit');
  });

  test('replay checksum mismatch => NO_GO', () => {
    const replay = { ...sign(buildReplay()), replayChecksum: 'sha256:bad' };
    expect(validateReplayIntegrity(replay, replay.governance).blockers.map((item) => item.reason))
      .toContain('replay_checksum_mismatch');
  });

  test('replay hash corruption => NO_GO', () => {
    const replay = { ...sign(buildReplay()), replayHash: 'bad' };
    expect(validateReplayIntegrity(replay, replay.governance).blockers.map((item) => item.reason))
      .toContain('replay_hash_mismatch');
  });

  test('governance signature mismatch => NO_GO', () => {
    const replay = { ...sign(buildReplay()), governanceSignature: 'gov-sha256:bad' };
    expect(validateReplayIntegrity(replay, replay.governance).blockers.map((item) => item.reason))
      .toContain('governance_signature_mismatch');
  });

  test('replay tampering => NO_GO', () => {
    const replay = sign(buildReplay());
    replay.steps[0].observedMutations = ['tampered'];
    expect(validateReplayIntegrity(replay, replay.governance).blockers.map((item) => item.reason))
      .toContain('replay_hash_mismatch');
  });
});
