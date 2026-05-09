'use strict';

const {
  runFinalOperationalSmoke,
  assertReplayAudit,
  evaluateStrictGovernance,
  evaluateProductionReadiness,
} = require('../../../scripts/smoke/qa-waves-operational-final-smoke');
const operationalReplayValidator = require('../qa/operationalReplayValidator');
const { getOperationalStepContract } = require('../../../qa/contracts/operationalStepRegistry');

const realSmokeTest = process.env.RUN_QA_WAVES_PROD_LIKE_SMOKE === '1' ? test : test.skip;

function mutationalStep(flow, stepId) {
  return flow.replay.steps.find((step) => step.id === stepId);
}

function getFlow(summary, journeyId) {
  return (summary.flows || []).find((flow) => flow.journeyId === journeyId);
}

function getStepProvenance(flow, step) {
  if (Array.isArray(step?.mutationProvenance) && step.mutationProvenance.length > 0) {
    return step.mutationProvenance;
  }
  if (Array.isArray(step?.postStateProof?.mutationProvenance) && step.postStateProof.mutationProvenance.length > 0) {
    return step.postStateProof.mutationProvenance;
  }
  const summaryProvenance = flow?.replay?.postStateSummary?.mutationProvenance || [];
  return summaryProvenance.filter((record) => record?.originatingStepId === step?.id);
}

describe('QA Waves final operational readiness', () => {
  let realSmokeSummary;

  async function getRealSmokeSummary() {
    if (!realSmokeSummary) {
      realSmokeSummary = await runFinalOperationalSmoke();
    }
    return realSmokeSummary;
  }

  realSmokeTest('support_ticket_flow end-to-end real browser smoke', async () => {
    const summary = await getRealSmokeSummary();
    const support = getFlow(summary, 'support_ticket_flow');
    const reply = mutationalStep(support, 'step_reply_ticket');
    const status = mutationalStep(support, 'step_change_status');
    const backendAssert = support.replay.steps.find((step) => step.id === 'step_assert_ticket_backend');

    expect(summary.productionReadiness.decision).toBe('GO');
    expect(support.audit.valid).toBe(true);
    expect(support.strictGovernance.valid).toBe(true);
    expect(support.replay.steps.filter((step) => step.status === 'failed')).toHaveLength(0);
    expect(support.replay.steps.filter((step) => Array.isArray(step.missingEvidence) && step.missingEvidence.length > 0)).toHaveLength(0);
    expect(reply.observedMutations).toContain('message_created');
    expect(reply.observedSideEffects).toContain('audit_log_created');
    expect(status.observedMutations).toContain('ticket_status_changed');
    expect(status.observedSideEffects).toContain('audit_log_created');
    expect(getStepProvenance(support, reply).every((record) => record.valid === true)).toBe(true);
    expect(getStepProvenance(support, status).every((record) => record.valid === true)).toBe(true);
    expect(backendAssert.status).toBe('passed');
    expect(backendAssert.mutationExpected).toBe(false);
    expect(backendAssert.missingEvidence || []).toHaveLength(0);
  }, 120000);

  realSmokeTest('fitness_customer_checkin end-to-end real browser smoke', async () => {
    const summary = await getRealSmokeSummary();
    const fitness = getFlow(summary, 'fitness_customer_checkin');
    const submit = mutationalStep(fitness, 'step_submit_checkin');

    expect(summary.productionReadiness.decision).toBe('GO');
    expect(fitness.audit.valid).toBe(true);
    expect(fitness.strictGovernance.valid).toBe(true);
    expect(submit.observedMutations).toContain('attendance_created');
    expect(submit.observedSideEffects).toEqual(expect.arrayContaining([
      'access_decision_created',
      'access_event_created',
      'crm_journey_updated',
    ]));
    expect(getStepProvenance(fitness, submit).every((record) => record.valid === true)).toBe(true);
  }, 120000);

  test('registry classifica step_assert_ticket_backend como assertion nao mutacional', () => {
    const contract = getOperationalStepContract('step_assert_ticket_backend');

    expect(contract).toEqual(expect.objectContaining({
      actionType: 'assert_backend_state',
      mutationExpected: false,
      snapshotRequired: false,
      requiresIncrementalDiff: false,
      requiresMutationLinkage: false,
      requiresProvenance: false,
    }));
  });

  test('replay audit completeness rejects partial replay', () => {
    const audit = assertReplayAudit({
      steps: [{
        id: 'step_reply_ticket',
        mutationExpected: true,
        evidenceClassification: 'operational',
        screenshotAfter: 'after',
        url: '/support',
        networkEvents: [],
        incrementalDiff: { changed: false },
        mutationLinkage: null,
        mutationProvenance: [],
      }],
    });

    expect(audit.valid).toBe(false);
    expect(audit.blockers).toEqual(expect.arrayContaining([
      'step_reply_ticket:missing_screenshot_before',
      'step_reply_ticket:missing_incremental_diff',
      'step_reply_ticket:missing_mutation_linkage',
      'step_reply_ticket:missing_provenance',
    ]));
  });

  test('single mutational flow accepts provenance from postStateSummary fallback', () => {
    const audit = assertReplayAudit({
      steps: [{
        id: 'step_submit_checkin',
        mutationExpected: true,
        evidenceClassification: 'operational',
        screenshotBefore: 'before',
        screenshotAfter: 'after',
        url: '/operations-dashboard',
        networkEvents: [],
        incrementalDiff: { changed: true },
        mutationLinkage: {
          expectedMutations: ['attendance_created'],
        },
        mutationProvenance: [],
      }],
      postStateSummary: {
        mutationProvenance: [{ mutation: 'attendance_created', valid: true, correlatedBy: 'network_linkage' }],
      },
    });

    expect(audit.valid).toBe(true);
    expect(audit.blockers).not.toContain('step_submit_checkin:missing_provenance');
  });

  test('multi mutational flow accepts step-scoped provenance from postStateSummary fallback', () => {
    const audit = assertReplayAudit({
      steps: [{
        id: 'step_reply_ticket',
        mutationExpected: true,
        evidenceClassification: 'operational',
        screenshotBefore: 'before-reply',
        screenshotAfter: 'after-reply',
        url: '/support/ticket/1',
        networkEvents: [{ method: 'POST', url: '/api/tickets/1/reply', status: 201 }],
        incrementalDiff: { changed: true },
        mutationLinkage: {
          expectedMutations: ['message_created'],
        },
        mutationProvenance: [],
      }, {
        id: 'step_change_status',
        mutationExpected: true,
        evidenceClassification: 'operational',
        screenshotBefore: 'before-status',
        screenshotAfter: 'after-status',
        url: '/support/ticket/1',
        networkEvents: [{ method: 'POST', url: '/api/tickets/1/close', status: 200 }],
        incrementalDiff: { changed: true },
        mutationLinkage: {
          expectedMutations: ['ticket_status_changed'],
        },
        mutationProvenance: [],
      }],
      postStateSummary: {
        mutationProvenance: [{
          mutation: 'message_created',
          valid: true,
          correlatedBy: 'network_linkage',
          originatingStepId: 'step_reply_ticket',
        }, {
          mutation: 'ticket_status_changed',
          valid: true,
          correlatedBy: 'network_linkage',
          originatingStepId: 'step_change_status',
        }],
      },
    });

    expect(audit.valid).toBe(true);
    expect(audit.blockers).not.toContain('step_reply_ticket:missing_provenance');
    expect(audit.blockers).not.toContain('step_change_status:missing_provenance');
  });

  test('governance ignores diagnostic evidence and refuses diagnostic GO', () => {
    const result = evaluateStrictGovernance({
      steps: [{
        id: 'step_reply_ticket',
        mutationExpected: true,
        evidenceClassification: 'diagnostic_only',
        incrementalDiff: { changed: true },
        mutationLinkage: {
          expectedMutations: ['message_created'],
          observedMutations: ['message_created'],
          expectedSideEffects: ['audit_log_created'],
          observedSideEffects: ['audit_log_created'],
        },
        observedMutations: ['message_created'],
        observedSideEffects: ['audit_log_created'],
        networkCorrelation: [{ method: 'POST', url: '/api/tickets/1/reply', status: 201 }],
        mutationProvenance: [{ mutation: 'message_created', valid: true, correlatedBy: 'network_linkage' }],
      }],
    });

    expect(result.valid).toBe(false);
    expect(result.blockers).toContain('step_reply_ticket:non_operational_evidence');
  });

  test('provenance.valid is mandatory', () => {
    const result = evaluateStrictGovernance({
      steps: [{
        id: 'step_reply_ticket',
        mutationExpected: true,
        evidenceClassification: 'operational',
        incrementalDiff: { changed: true },
        mutationLinkage: {
          expectedMutations: ['message_created'],
          expectedSideEffects: ['audit_log_created'],
        },
        observedMutations: ['message_created'],
        observedSideEffects: ['audit_log_created'],
        networkCorrelation: [{ method: 'POST', url: '/api/tickets/1/reply', status: 201 }],
        mutationProvenance: [{ mutation: 'message_created', valid: false, correlatedBy: 'network_linkage' }],
      }],
    });

    expect(result.valid).toBe(false);
    expect(result.blockers).toContain('step_reply_ticket:provenance_invalid:message_created');
  });

  test('single mutational flow accepts network and provenance from postStateSummary fallback', () => {
    const result = evaluateStrictGovernance({
      steps: [{
        id: 'step_submit_checkin',
        mutationExpected: true,
        evidenceClassification: 'operational',
        incrementalDiff: { changed: true },
        mutationLinkage: {
          expectedMutations: ['attendance_created'],
          expectedSideEffects: ['access_decision_created'],
        },
        observedMutations: ['attendance_created'],
        observedSideEffects: ['access_decision_created'],
        networkCorrelation: [],
        mutationProvenance: [],
      }],
      postStateSummary: {
        networkCorrelation: [{ method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 }],
        mutationProvenance: [{ mutation: 'attendance_created', valid: true, correlatedBy: 'network_linkage' }],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.blockers).not.toContain('step_submit_checkin:expected_network_event_missing');
    expect(result.blockers).not.toContain('step_submit_checkin:provenance_missing');
  });

  test('multi mutational flow accepts step-scoped network and provenance from postStateSummary fallback', () => {
    const result = evaluateStrictGovernance({
      steps: [{
        id: 'step_reply_ticket',
        mutationExpected: true,
        evidenceClassification: 'operational',
        incrementalDiff: { changed: true },
        mutationLinkage: {
          expectedMutations: ['message_created'],
          expectedSideEffects: ['audit_log_created'],
        },
        observedMutations: ['message_created'],
        observedSideEffects: ['audit_log_created'],
        networkCorrelation: [],
        mutationProvenance: [],
      }, {
        id: 'step_change_status',
        mutationExpected: true,
        evidenceClassification: 'operational',
        incrementalDiff: { changed: true },
        mutationLinkage: {
          expectedMutations: ['ticket_status_changed'],
          expectedSideEffects: ['audit_log_created'],
        },
        observedMutations: ['ticket_status_changed'],
        observedSideEffects: ['audit_log_created'],
        networkCorrelation: [],
        mutationProvenance: [],
      }],
      postStateSummary: {
        networkCorrelation: [
          { method: 'POST', url: '/api/tickets/1/reply', status: 201 },
          { method: 'POST', url: '/api/tickets/1/close', status: 200 },
        ],
        mutationProvenance: [{
          mutation: 'message_created',
          valid: true,
          correlatedBy: 'network_linkage',
          originatingStepId: 'step_reply_ticket',
        }, {
          mutation: 'ticket_status_changed',
          valid: true,
          correlatedBy: 'network_linkage',
          originatingStepId: 'step_change_status',
        }],
      },
    });

    expect(result.valid).toBe(true);
    expect(result.blockers).not.toContain('step_reply_ticket:expected_network_event_missing');
    expect(result.blockers).not.toContain('step_reply_ticket:provenance_missing');
    expect(result.blockers).not.toContain('step_change_status:expected_network_event_missing');
    expect(result.blockers).not.toContain('step_change_status:provenance_missing');
  });

  test('exact mutation and side effect matching are mandatory', () => {
    const result = evaluateStrictGovernance({
      steps: [{
        id: 'step_reply_ticket',
        mutationExpected: true,
        evidenceClassification: 'operational',
        incrementalDiff: { changed: true },
        mutationLinkage: {
          expectedMutations: ['message_created'],
          expectedSideEffects: ['audit_log_created'],
        },
        observedMutations: ['message_created_alias'],
        observedSideEffects: ['audit_log_created_alias'],
        networkCorrelation: [{ method: 'POST', url: '/api/tickets/1/reply', status: 201 }],
        mutationProvenance: [{ mutation: 'message_created_alias', valid: true, correlatedBy: 'network_linkage' }],
      }],
    });

    expect(result.valid).toBe(false);
    expect(result.blockers).toContain('step_reply_ticket:mutation_mismatch:message_created');
    expect(result.blockers).toContain('step_reply_ticket:side_effect_mismatch:audit_log_created');
  });

  test('fixture smoke nunca concede GO de produção', () => {
    const readiness = evaluateProductionReadiness({
      environment: {
        mode: 'technical_fixture',
        usedFixtureServer: true,
        tenantIsolated: false,
      },
      flows: [{
        journeyId: 'support_ticket_flow',
        audit: { valid: true },
        strictGovernance: { valid: true },
        governance: { goNoGo: 'GO', blockers: [] },
      }],
    });

    expect(readiness.decision).toBe('NO_GO');
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      'fixture_or_non_prod_like_smoke_cannot_grant_production_go',
      'fixture_http_server_used',
    ]));
  });

  test('proof chain determinística remove blocker replay_missing_state_transition', () => {
    const replay = {
      journeyId: 'support_ticket_flow',
      screenshots: ['before', 'after'],
      pages: ['/support', '/support/ticket/1'],
      steps: [{
        id: 'step_reply_ticket',
        evidenceClassification: 'operational',
        mutationExpected: true,
        screenshotBefore: 'before',
        screenshotAfter: 'after',
        url: '/support/ticket/1',
        networkEvents: [{ method: 'POST', url: '/api/tickets/1/reply', status: 201 }],
        networkCorrelation: [{ method: 'POST', url: '/api/tickets/1/reply', status: 201 }],
        incrementalDiff: { changed: true, details: [{ field: 'messages.count', before: 1, after: 2 }] },
        observedMutations: ['message_created'],
        observedSideEffects: ['audit_log_created'],
        mutationLinkage: {
          expectedMutations: ['message_created'],
          expectedSideEffects: ['audit_log_created'],
          correlatedBy: 'network_linkage',
        },
        mutationProvenance: [{ mutation: 'message_created', valid: true, correlatedBy: 'network_linkage' }],
      }],
    };

    const result = operationalReplayValidator.validateOperationalReplay(replay, { journeyId: 'support_ticket_flow' });
    const blockerReasons = (result.blockers || []).map((item) => item.reason);

    expect(operationalReplayValidator.replayHasDeterministicOperationalProof(replay)).toBe(true);
    expect(blockerReasons).not.toContain('replay_missing_state_transition');
  });

  test('proof chain em postStateProof remove falso negativo de provenance no replay validator', () => {
    const replay = {
      journeyId: 'fitness_customer_checkin',
      screenshots: ['before', 'after'],
      pages: ['/operations-dashboard'],
      steps: [{
        id: 'step_submit_checkin',
        evidenceClassification: 'operational',
        mutationExpected: true,
        screenshotBefore: 'before',
        screenshotAfter: 'after',
        url: '/operations-dashboard',
        networkEvents: [{ method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 }],
        incrementalDiff: { changed: true, details: [{ field: 'db.attendance.count', before: 0, after: 1 }] },
        observedMutations: ['attendance_created'],
        observedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
        mutationLinkage: {
          expectedMutations: ['attendance_created'],
          expectedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
          correlatedBy: 'network_linkage',
        },
        mutationProvenance: [],
        networkCorrelation: [],
        postStateProof: {
          valid: true,
          observedMutations: ['attendance_created'],
          observedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
          networkCorrelation: [{ method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 }],
          mutationProvenance: [{
            mutation: 'attendance_created',
            valid: true,
            correlatedBy: 'network_linkage',
            originatingStepId: 'step_submit_checkin',
            originatingActionType: 'checkin_submit',
            originatingNetworkEvent: { method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 },
            entityScope: ['attendance', 'access_decision', 'access_event', 'crm_journey'],
            beforeStepSnapshotHash: '7db4b772',
            afterStepSnapshotHash: 'dae17703',
          }],
        },
      }],
    };

    const result = operationalReplayValidator.validateOperationalReplay(replay, { journeyId: 'fitness_customer_checkin' });
    const blockerReasons = (result.blockers || []).map((item) => item.reason);

    expect(operationalReplayValidator.replayHasDeterministicOperationalProof(replay)).toBe(true);
    expect(blockerReasons).not.toContain('mutation_provenance_missing');
    expect(blockerReasons).not.toContain('replay_missing_state_transition');
  });

  test('postStateSummary em replay remove falso negativo legado em fitness com único step mutacional', () => {
    const replay = {
      journeyId: 'fitness_customer_checkin',
      beforeSnapshot: { attendance: { count: 0 } },
      afterSnapshot: { attendance: { count: 1 } },
      screenshots: ['before', 'after'],
      pages: ['/operations-dashboard'],
      steps: [{
        id: 'step_submit_checkin',
        evidenceClassification: 'operational',
        mutationExpected: true,
        screenshotBefore: 'before',
        screenshotAfter: 'after',
        url: '/operations-dashboard',
        networkEvents: [{ method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 }],
        incrementalDiff: { changed: true, details: [{ field: 'db.attendance.count', before: 0, after: 1 }] },
        observedMutations: ['attendance_created'],
        observedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
        mutationLinkage: {
          expectedMutations: ['attendance_created'],
          expectedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
          correlatedBy: 'network_linkage',
        },
        mutationProvenance: [],
        networkCorrelation: [],
        postStateProof: null,
      }],
      postStateSummary: {
        observedMutations: ['attendance_created'],
        observedSideEffects: ['access_decision_created', 'access_event_created', 'crm_journey_updated'],
        networkCorrelation: [{ method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 }],
        mutationProvenance: [{
          mutation: 'attendance_created',
          valid: true,
          correlatedBy: 'network_linkage',
          originatingStepId: 'step_submit_checkin',
          originatingActionType: 'checkin_submit',
          originatingNetworkEvent: { method: 'POST', url: '/api/access-control/decisions/resolve', status: 200 },
          entityScope: ['attendance', 'access_decision', 'access_event', 'crm_journey'],
          beforeStepSnapshotHash: '3baba67c',
          afterStepSnapshotHash: '8c41ea33',
        }],
      },
    };

    const result = operationalReplayValidator.validateOperationalReplay(replay, { journeyId: 'fitness_customer_checkin' });
    const blockerReasons = (result.blockers || []).map((item) => item.reason);

    expect(operationalReplayValidator.replayHasDeterministicOperationalProof(replay)).toBe(true);
    expect(result.preconditionFailed).not.toBe(true);
    expect(blockerReasons).not.toContain('mutation_provenance_missing');
    expect(blockerReasons).not.toContain('replay_missing_state_transition');
  });

  test('postStateSummary em replay remove falso negativo legado em suporte multi-step por originatingStepId', () => {
    const replay = {
      journeyId: 'support_ticket_flow',
      screenshots: ['before', 'after'],
      pages: ['/support', '/support/ticket/1'],
      steps: [{
        id: 'step_reply_ticket',
        evidenceClassification: 'operational',
        mutationExpected: true,
        screenshotBefore: 'before',
        screenshotAfter: 'after',
        url: '/support/ticket/1',
        networkEvents: [{ method: 'POST', url: '/api/tickets/1/reply', status: 201 }],
        incrementalDiff: { changed: true, details: [{ field: 'messages.count', before: 1, after: 2 }] },
        observedMutations: ['message_created'],
        observedSideEffects: ['audit_log_created'],
        mutationLinkage: {
          expectedMutations: ['message_created'],
          expectedSideEffects: ['audit_log_created'],
          correlatedBy: 'network_linkage',
        },
        mutationProvenance: [],
        networkCorrelation: [],
      }, {
        id: 'step_change_status',
        evidenceClassification: 'operational',
        mutationExpected: true,
        screenshotBefore: 'before-2',
        screenshotAfter: 'after-2',
        url: '/support/ticket/1',
        networkEvents: [{ method: 'POST', url: '/api/tickets/1/close', status: 200 }],
        incrementalDiff: { changed: true, details: [{ field: 'ticket.status', before: 'in_progress', after: 'closed' }] },
        observedMutations: ['ticket_status_changed'],
        observedSideEffects: ['audit_log_created'],
        mutationLinkage: {
          expectedMutations: ['ticket_status_changed'],
          expectedSideEffects: ['audit_log_created'],
          correlatedBy: 'network_linkage',
        },
        mutationProvenance: [],
        networkCorrelation: [],
      }],
      postStateSummary: {
        networkCorrelation: [
          { method: 'POST', url: '/api/tickets/1/reply', status: 201 },
          { method: 'POST', url: '/api/tickets/1/close', status: 200 },
        ],
        mutationProvenance: [{
          mutation: 'message_created',
          valid: true,
          correlatedBy: 'network_linkage',
          originatingStepId: 'step_reply_ticket',
          originatingActionType: 'type_and_send',
          originatingNetworkEvent: { method: 'POST', url: '/api/tickets/1/reply', status: 201 },
          entityScope: ['ticket', 'messages', 'audit', 'crm'],
          beforeStepSnapshotHash: 'reply-before',
          afterStepSnapshotHash: 'reply-after',
        }, {
          mutation: 'ticket_status_changed',
          valid: true,
          correlatedBy: 'network_linkage',
          originatingStepId: 'step_change_status',
          originatingActionType: 'change_status',
          originatingNetworkEvent: { method: 'POST', url: '/api/tickets/1/close', status: 200 },
          entityScope: ['ticket.status', 'audit'],
          beforeStepSnapshotHash: 'status-before',
          afterStepSnapshotHash: 'status-after',
        }],
      },
    };

    const result = operationalReplayValidator.validateOperationalReplay(replay, { journeyId: 'support_ticket_flow' });
    const blockerReasons = (result.blockers || []).map((item) => item.reason);

    expect(operationalReplayValidator.replayHasDeterministicOperationalProof(replay)).toBe(true);
    expect(blockerReasons).not.toContain('mutation_provenance_missing');
    expect(blockerReasons).not.toContain('replay_missing_state_transition');
  });
});
