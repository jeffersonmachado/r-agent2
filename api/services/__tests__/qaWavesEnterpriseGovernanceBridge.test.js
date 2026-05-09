'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildQaWavesEnterpriseGovernance,
  validateQaWavesEnterpriseGovernance,
  writeQaWavesEnterpriseGovernance,
} = require('../../../tools/system/lib/qa-waves-enterprise-governance-bridge');
const { signReplayArtifact } = require('../qa/replayIntegrityService');

function makeReplay(journeyId, step) {
  const governance = { goNoGo: 'GO', isOperational: true, blockers: [] };
  return signReplayArtifact({
    id: `replay-${journeyId}`,
    journeyId,
    status: 'GO',
    governance,
    screenshots: [{ id: 's1', data: 'data:image/png;base64,abc', critical: true }],
    steps: [step],
    postStateSummary: {
      mutationProvenance: step.mutationProvenance || [],
      networkCorrelation: step.networkCorrelation || [],
    },
  }, {
    governance,
    tenantId: 'tenant-enterprise-test',
    environment: { mode: 'prod_like_real_stack' },
    smokeExecutionId: `smoke-${journeyId}`,
  });
}

function makeStep() {
  return {
    id: 'step_submit_checkin',
    status: 'passed',
    actionType: 'checkin_submit',
    semanticContract: {
      stepId: 'step_submit_checkin',
      actionType: 'checkin_submit',
      mutationExpected: true,
    },
    postStateProof: {
      valid: true,
      observedMutations: ['attendance_created'],
      observedSideEffects: ['access_decision_created'],
      missingMutations: [],
      missingSideEffects: [],
    },
    mutationProvenance: [{
      mutation: 'attendance_created',
      valid: true,
      correlatedBy: 'network_linkage',
      originatingStepId: 'step_submit_checkin',
      originatingActionType: 'checkin_submit',
      originatingNetworkEvent: { method: 'POST', url: '/api/access-control/decisions/resolve', status: 201 },
      entityScope: ['attendance'],
      beforeStepSnapshotHash: 'before',
      afterStepSnapshotHash: 'after',
    }],
    networkCorrelation: [{ method: 'POST', url: '/api/access-control/decisions/resolve', status: 201 }],
  };
}

function makeProdLike(overrides = {}) {
  const supportReplay = makeReplay('support_ticket_flow', {
    ...makeStep(),
    id: 'step_reply_ticket',
    actionType: 'type_and_send',
    semanticContract: { stepId: 'step_reply_ticket', actionType: 'type_and_send', mutationExpected: true },
    mutationProvenance: [{
      ...makeStep().mutationProvenance[0],
      originatingStepId: 'step_reply_ticket',
      originatingActionType: 'type_and_send',
      mutation: 'message_created',
    }],
  });
  const fitnessReplay = makeReplay('fitness_customer_checkin', makeStep());
  return {
    generatedAt: '2026-05-09T10:50:20.513Z',
    status: 'GO',
    productionReadiness: { decision: 'GO', blockers: [] },
    flows: [
      { journeyId: 'support_ticket_flow', governance: { goNoGo: 'GO', blockers: [] }, strictGovernance: { blockers: [] }, audit: { blockers: [] }, replay: supportReplay },
      { journeyId: 'fitness_customer_checkin', governance: { goNoGo: 'GO', blockers: [] }, strictGovernance: { blockers: [] }, audit: { blockers: [] }, replay: fitnessReplay },
    ],
    ...overrides,
  };
}

function writeFixture({ prodLike = makeProdLike(), scheduled = { status: 'GO', scheduledMode: { id: 'hourly_lightweight' } } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-enterprise-'));
  const prodLikePath = path.join(root, 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
  const scheduledPath = path.join(root, 'qa/smoke/qa-waves-scheduled-operational-smoke.json');
  fs.mkdirSync(path.dirname(prodLikePath), { recursive: true });
  fs.mkdirSync(path.dirname(scheduledPath), { recursive: true });
  fs.writeFileSync(prodLikePath, `${JSON.stringify(prodLike, null, 2)}\n`);
  fs.writeFileSync(scheduledPath, `${JSON.stringify(scheduled, null, 2)}\n`);
  return { root, prodLikePath, scheduledPath, prodLike, scheduled };
}

describe('QA Waves enterprise governance bridge', () => {
  test('QA Waves GO refletindo em system:go-no-go', () => {
    const fixture = writeFixture();
    const report = buildQaWavesEnterpriseGovernance(fixture);
    const validation = validateQaWavesEnterpriseGovernance(report);

    expect(report.governanceStatus).toBe('GO');
    expect(report.operationalConfidence).toBeGreaterThanOrEqual(95);
    expect(validation.valid).toBe(true);
  });

  test('replay tampering => global NO_GO', () => {
    const prodLike = makeProdLike();
    prodLike.flows[1].replay.steps[0].status = 'tampered';
    const fixture = writeFixture({ prodLike });
    const report = buildQaWavesEnterpriseGovernance(fixture);

    expect(report.governanceStatus).toBe('NO_GO');
    expect(validateQaWavesEnterpriseGovernance(report).reasons).toContain('qa_waves_replay_integrity_invalid');
  });

  test('governance signature invalid => release NO_GO', () => {
    const prodLike = makeProdLike();
    prodLike.flows[0].replay.governanceSignature = 'gov-sha256:invalid';
    const fixture = writeFixture({ prodLike });
    const report = buildQaWavesEnterpriseGovernance(fixture);

    expect(report.governanceSignature.valid).toBe(false);
    expect(validateQaWavesEnterpriseGovernance(report).reasons).toContain('qa_waves_governance_signature_invalid');
  });

  test('operational confidence degraded => deploy blocked', () => {
    const fixture = writeFixture();
    const report = buildQaWavesEnterpriseGovernance({ ...fixture, threshold: 100.1 });
    const validation = validateQaWavesEnterpriseGovernance(report, { threshold: 100.1 });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toContain('qa_waves_operational_confidence_degraded');
    expect(report.deploymentSafety.deployAllowed).toBe(false);
  });

  test('smoke degraded => release blocked', () => {
    const fixture = writeFixture({ scheduled: { status: 'NO_GO', scheduledMode: { id: 'hourly_lightweight' } } });
    const report = buildQaWavesEnterpriseGovernance(fixture);
    const validation = validateQaWavesEnterpriseGovernance(report);

    expect(report.continuousValidationStatus.healthy).toBe(false);
    expect(validation.reasons).toContain('qa_waves_continuous_smoke_degraded');
  });

  test('enterprise governance audit trail persistence', () => {
    const fixture = writeFixture();
    const report = buildQaWavesEnterpriseGovernance(fixture);
    const out = path.join(fixture.root, 'qa/qa-waves-enterprise-governance.json');
    const audit = path.join(fixture.root, 'qa/qa-waves-governance-audit.jsonl');

    writeQaWavesEnterpriseGovernance(report, out, audit);
    writeQaWavesEnterpriseGovernance(report, out, audit);

    const lines = fs.readFileSync(audit, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    expect(second.previousEntryHash).toBe(first.entryHash);
  });

  test('deployment governance enforcement', () => {
    const prodLike = makeProdLike({ status: 'NO_GO', productionReadiness: { decision: 'NO_GO', blockers: ['failed_mutation_proof'] } });
    const fixture = writeFixture({ prodLike });
    const report = buildQaWavesEnterpriseGovernance(fixture);
    const validation = validateQaWavesEnterpriseGovernance(report);

    expect(validation.valid).toBe(false);
    expect(report.deploymentSafety.deployAllowed).toBe(false);
  });
});
