'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  buildQaWavesEnterpriseGovernance,
  validateQaWavesEnterpriseGovernance,
  writeQaWavesEnterpriseGovernance,
  verifyGovernanceAuditTrail,
} = require('../../../tools/system/lib/qa-waves-enterprise-governance-bridge');
const { signReplayArtifact } = require('../qa/replayIntegrityService');

const NOW = new Date('2026-08-14T12:00:00.000Z');

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
  const bookingReplay = makeReplay('booking_flow', makeStep());
  return {
    generatedAt: '2026-08-14T11:59:00.000Z',
    status: 'GO',
    productionReadiness: { decision: 'GO', blockers: [] },
    environment: {
      mode: 'prod_like_real_stack',
      usedFixtureServer: false,
      backend: 'real_stack',
      database: 'real',
      tenantIsolated: true,
    },
    flows: [
      { journeyId: 'support_ticket_flow', governance: { goNoGo: 'GO', blockers: [] }, strictGovernance: { blockers: [] }, audit: { blockers: [] }, replay: supportReplay },
      { journeyId: 'fitness_customer_checkin', governance: { goNoGo: 'GO', blockers: [] }, strictGovernance: { blockers: [] }, audit: { blockers: [] }, replay: fitnessReplay },
      { journeyId: 'booking_flow', governance: { goNoGo: 'GO', blockers: [] }, strictGovernance: { blockers: [] }, audit: { blockers: [] }, replay: bookingReplay },
    ],
    ...overrides,
  };
}

function makeScheduledFlow(journeyId, replay) {
  return {
    journeyId,
    goNoGo: 'GO',
    replayHash: replay.replayHash,
    replayChecksum: replay.replayChecksum,
    governanceSignature: replay.governanceSignature,
    integrityValid: true,
    failedResidualSteps: [],
    missingEvidence: [],
  };
}

function writeFixture({ prodLike = makeProdLike(), scheduled = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-waves-enterprise-'));
  const prodLikePath = path.join(root, 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
  const scheduledPath = path.join(root, 'qa/smoke/qa-waves-scheduled-operational-smoke.json');
  fs.mkdirSync(path.dirname(prodLikePath), { recursive: true });
  fs.mkdirSync(path.dirname(scheduledPath), { recursive: true });
  fs.writeFileSync(prodLikePath, `${JSON.stringify(prodLike, null, 2)}\n`);
  const evidenceSha256 = crypto.createHash('sha256').update(fs.readFileSync(prodLikePath)).digest('hex');
  const effectiveScheduled = scheduled || {
    generatedAt: NOW.toISOString(),
    sourceGeneratedAt: prodLike.generatedAt,
    status: 'GO',
    governanceStatus: 'GO',
    scheduledMode: { id: 'nightly_full_replay', realStack: true },
    releaseEvidenceEligible: true,
    blockers: [],
    evidencePath: prodLikePath,
    evidenceSha256,
    flows: prodLike.flows.map((flow) => makeScheduledFlow(flow.journeyId, flow.replay)),
  };
  fs.writeFileSync(scheduledPath, `${JSON.stringify(effectiveScheduled, null, 2)}\n`);
  return { root, prodLikePath, scheduledPath, prodLike, scheduled: effectiveScheduled, now: NOW };
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

  test('status GO sem conteúdo ou evidência não libera release', () => {
    const fixture = writeFixture({
      scheduled: {
        generatedAt: NOW.toISOString(),
        status: 'GO',
        governanceStatus: 'GO',
        blockers: [],
        evidencePath: null,
        flows: [],
      },
    });
    const report = buildQaWavesEnterpriseGovernance(fixture);

    expect(report.governanceStatus).toBe('NO_GO');
    expect(report.continuousValidationStatus.reasons).toEqual(expect.arrayContaining([
      'scheduled_evidence_path_invalid',
      'scheduled_flows_missing',
      'scheduled_required_journeys_missing',
    ]));
  });

  test('evidência agendada vencida ou sem booking_flow falha fechada', () => {
    const baseline = writeFixture();
    const scheduled = {
      ...baseline.scheduled,
      generatedAt: '2026-08-10T00:00:00.000Z',
      flows: baseline.scheduled.flows.filter((flow) => flow.journeyId !== 'booking_flow'),
    };
    fs.writeFileSync(baseline.scheduledPath, `${JSON.stringify(scheduled, null, 2)}\n`);
    const report = buildQaWavesEnterpriseGovernance({ ...baseline, scheduled });

    expect(report.governanceStatus).toBe('NO_GO');
    expect(report.continuousValidationStatus.reasons).toEqual(expect.arrayContaining([
      'scheduled_evidence_stale',
      'scheduled_required_journeys_missing',
    ]));
    expect(report.continuousValidationStatus.missingJourneys).toContain('booking_flow');
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
    expect(verifyGovernanceAuditTrail(audit)).toEqual(expect.objectContaining({
      valid: true,
      entries: 2,
      lastEntryHash: second.entryHash,
    }));
  });

  test('chave de assinatura ausente produz NO_GO persistível em vez de crash', () => {
    const fixture = writeFixture();
    const originalKey = process.env.REPLAY_SIGNING_KEY;
    const originalEncryptionKey = process.env.ENCRYPTION_KEY;
    delete process.env.REPLAY_SIGNING_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      const report = buildQaWavesEnterpriseGovernance(fixture);
      expect(report.governanceStatus).toBe('NO_GO');
      expect(report.enterpriseGovernanceSignature).toBeNull();
      expect(report.activeBlockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ reason: 'enterprise_signing_key_unavailable' }),
      ]));
      expect(validateQaWavesEnterpriseGovernance(report).reasons).toContain(
        'qa_waves_enterprise_signing_key_unavailable'
      );
    } finally {
      if (originalKey === undefined) delete process.env.REPLAY_SIGNING_KEY;
      else process.env.REPLAY_SIGNING_KEY = originalKey;
      if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  test('trilha adulterada bloqueia nova decisão e relatório adulterado falha validação', () => {
    const fixture = writeFixture();
    const report = buildQaWavesEnterpriseGovernance(fixture);
    const out = path.join(fixture.root, 'qa/qa-waves-enterprise-governance.json');
    const audit = path.join(fixture.root, 'qa/qa-waves-governance-audit.jsonl');
    writeQaWavesEnterpriseGovernance(report, out, audit);

    const entry = JSON.parse(fs.readFileSync(audit, 'utf8').trim());
    entry.decision = 'NO_GO';
    fs.writeFileSync(audit, `${JSON.stringify(entry)}\n`);

    expect(verifyGovernanceAuditTrail(audit).valid).toBe(false);
    expect(() => writeQaWavesEnterpriseGovernance(report, out, audit))
      .toThrow(/qa_waves_governance_audit_invalid/);

    const tamperedReport = { ...report, governanceStatus: 'NO_GO' };
    expect(validateQaWavesEnterpriseGovernance(tamperedReport).reasons).toEqual(expect.arrayContaining([
      'qa_waves_enterprise_report_hash_invalid',
      'qa_waves_enterprise_signature_invalid',
    ]));
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
