'use strict';

const fs = require('fs');
const path = require('path');

const {
  deriveObservedMutations,
  validatePostStateProof,
  deriveStepScopedMutations,
} = require('../../../qa/evidence/postStateProofValidator');
const {
  validateEvidenceProof,
  validateSideEffectProof,
} = require('../../../qa/evidence/evidenceProofValidator');
const {
  executeAndEnrichStep,
  executeAndEnrichStepWithPostStateProof,
  validateJourneyPostStateProofs,
} = require('../qa/operationalStepExecutor');
const operationalReplayValidator = require('../qa/operationalReplayValidator');

function response(method, url, status) {
  return { type: 'response', method, url, status };
}

function blockingContext() {
  return {
    journeyId: 'support_ticket_flow',
    executionMode: 'operational_go',
    isBlockingJourney: true,
  };
}

describe('deterministic operational proof hardening', () => {
  test('regex/count mutation inference does not produce canonical mutation', () => {
    const diff = {
      changed: true,
      details: [{ field: 'messages_count', before: 1, after: 2 }],
    };

    expect(deriveObservedMutations(diff, { id: 'step_reply_ticket' })).toEqual([]);
  });

  test('generic field_changed fallback does not exist', () => {
    const diff = {
      changed: true,
      details: [{ field: 'custom.total', before: 1, after: 2 }],
    };

    expect(deriveObservedMutations(diff, { id: 'step_reply_ticket' })).toEqual([]);
  });

  test('proof validators reject includes-style side effect matches', () => {
    const result = validateSideEffectProof(
      ['audit_log_created_extra', 'crm_updated_extra', 'notification_sent_extra'],
      'step_reply_ticket',
      'type_and_send',
    );

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['audit_log_created']);
  });

  test('proof validator source has no observed includes mutation/side-effect matching', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../qa/evidence/evidenceProofValidator.js'),
      'utf8',
    );

    expect(source).not.toContain('String(obs).includes');
    expect(source).not.toContain('se.includes(obs)');
  });

  test('startsWith/partial mutation matching is rejected', () => {
    const result = validateEvidenceProof({
      step: {
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        selectorUsed: '#reply',
        networkEvents: [response('POST', '/api/tickets/1/reply', 201)],
        mutationLinkage: { observedMutations: ['message_created:legacy'] },
        sideEffectLinkage: { observedSideEffects: ['audit_log_created'] },
      },
      beforeSnapshot: { db: { messages: { count: 1 } } },
      afterSnapshot: { db: { messages: { count: 2 } } },
      journeyContext: blockingContext(),
    });

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.mutationProof.blockers.some((b) => b.reason === 'mutation_proof_expected_not_observed')).toBe(true);
  });

  test('partial mutation alias is NO_GO', () => {
    const result = validateEvidenceProof({
      step: {
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        selectorUsed: '#reply',
        networkEvents: [response('POST', '/api/tickets/1/reply', 201)],
        mutationLinkage: { observedMutations: ['message'] },
        sideEffectLinkage: { observedSideEffects: ['audit_log_created'] },
      },
      beforeSnapshot: { db: { messages: { count: 1 } } },
      afterSnapshot: { db: { messages: { count: 2 } } },
      journeyContext: blockingContext(),
    });

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('NO_GO');
  });

  test('mutationLinkage supplied before incrementalDiff is discarded', async () => {
    const result = await executeAndEnrichStep({
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      screenshotAfter: 'data:image/png;base64,after',
      selectorUsed: '#reply',
      networkEvents: [response('POST', '/api/tickets/1/reply', 201)],
      mutationLinkage: {
        mutationCount: 1,
        observedMutations: ['message_created'],
        correlatedBy: 'legacy_pre_incremental',
      },
    }, null, {
      journeyId: 'support_ticket_flow',
      executionMode: 'diagnostic',
    });

    expect(result.step.incrementalDiff?.hasSnapshots).toBe(false);
    expect(result.step.mutationLinkage).toBeNull();
  });

  test('generic 2xx networkCorrelation is rejected', () => {
    const before = {
      db: { messages: { count: 1 } },
      events: { audit: { count: 0 }, notifications: { count: 0 } },
      crm: { activities: { count: 0 } },
    };
    const after = {
      db: { messages: { count: 2 } },
      events: { audit: { count: 1 }, notifications: { count: 1 } },
      crm: { activities: { count: 1 } },
    };

    const result = deriveStepScopedMutations([{
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      beforeStepSnapshot: before,
      afterStepSnapshot: after,
      networkEvents: [response('GET', '/api/health', 200)],
    }], before, after);

    expect(result[0].scopedMutations).toEqual(['message_created']);
    expect(result[0].networkCorrelation).toEqual([]);
  });

  test('postStateSummary does not derive mutations from journeyDiff', () => {
    const result = validateJourneyPostStateProofs({
      beforeSnapshot: { db: { messages: { count: 1 } } },
      afterSnapshot: { db: { messages: { count: 2 } } },
      executedSteps: [{
        id: 'step_access_support_module',
        actionType: 'navigate',
        beforeStepSnapshot: { db: { messages: { count: 1 } } },
        afterStepSnapshot: { db: { messages: { count: 2 } } },
      }],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: blockingContext(),
    });

    expect(result.postStateSummary.summaryBasis).toBe('step_consolidated');
    expect(result.postStateSummary.observedMutations).toEqual([]);
    expect(result.postStateSummary.mutationProvenance).toEqual([]);
  });

  test('operational source does not call deriveObservedMutations(journeyDiff)', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../qa/operationalStepExecutor.js'),
      'utf8',
    );

    expect(source).not.toContain('deriveObservedMutations(journeyDiff)');
  });

  test('executeAndEnrichStepWithPostStateProof is blocked in operational_go', async () => {
    await expect(executeAndEnrichStepWithPostStateProof({
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
    }, null, {
      journeyId: 'support_ticket_flow',
      executionMode: 'operational_go',
    })).rejects.toThrow('legacy_post_state_helper_not_allowed_operational_go');
  });

  test('declarative mutationLinkage in stepSpec fails operational_go', async () => {
    const result = await executeAndEnrichStep({
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      mutationLinkage: { mutationCount: 1, observedMutations: ['message_created'] },
    }, null, {
      journeyId: 'support_ticket_flow',
      executionMode: 'operational_go',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('mutation_linkage_declarative_not_allowed');
  });

  test('stateMutation used as step proof fails operational_go', async () => {
    const result = await executeAndEnrichStep({
      id: 'step_reply_ticket',
      actionType: 'type_and_send',
      mutationLinkage: { source: 'stateMutation', mutationCount: 1 },
    }, null, {
      journeyId: 'support_ticket_flow',
      executionMode: 'operational_go',
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.step.error).toBe('state_mutation_not_allowed_as_step_proof');
  });

  test('stateMutation mutationLinkage in post-state validation fails', () => {
    const result = validateJourneyPostStateProofs({
      beforeSnapshot: { db: { messages: { count: 1 } } },
      afterSnapshot: { db: { messages: { count: 2 } } },
      executedSteps: [{
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        mutationLinkage: { source: 'stateMutation', mutationCount: 1 },
        beforeStepSnapshot: { db: { messages: { count: 1 } } },
        afterStepSnapshot: { db: { messages: { count: 2 } } },
        networkEvents: [response('POST', '/api/tickets/1/reply', 201)],
      }],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: blockingContext(),
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'state_mutation_not_allowed_as_step_proof')).toBe(true);
  });

  test('diagnostic_only cannot generate operational GO', () => {
    const replay = {
      replayId: 'diag-only',
      journeyId: 'support_ticket_flow',
      afterSnapshot: { state: 'diagnostic' },
      steps: [{
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        evidenceClassification: 'diagnostic_only',
        page: '/support',
        url: '/support',
        selectorUsed: '#reply',
        screenshotBefore: 'before.png',
        screenshotAfter: 'after.png',
        networkEvents: [response('POST', '/api/tickets/1/reply', 201)],
        evidenceId: 'diag-step',
      }],
      screenshots: [{ path: 'after.png', description: 'diag', timestamp: '2026-01-01T00:00:00.000Z', critical: true, type: 'validation' }],
      events: [{ type: 'api_call', page: '/support', module: 'support', operation: 'write', stateChange: true }],
      rawStepCount: 1,
      rawScreenshotCount: 1,
    };

    const result = operationalReplayValidator.validateOperationalReplay(replay, { journeyId: 'support_ticket_flow' });
    expect(result.isOperational).toBe(false);
    expect(result.goNoGo).toBe('REVIEW');
    expect(result.blockers.some((b) => b.reason === 'operational_evidence_missing')).toBe(true);
  });

  test('journey_transition cannot generate operational GO', () => {
    const result = validateJourneyPostStateProofs({
      beforeSnapshot: { state: 'open' },
      afterSnapshot: { state: 'changed' },
      executedSteps: [{
        id: 'step_reply_ticket',
        actionType: 'type_and_send',
        mutationLinkage: { correlatedBy: 'journey_transition', mutationCount: 1 },
        beforeStepSnapshot: { db: { messages: { count: 1 } } },
        afterStepSnapshot: { db: { messages: { count: 2 } } },
        networkEvents: [response('POST', '/api/tickets/1/reply', 201)],
      }],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: blockingContext(),
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'operational_journey_transition_not_allowed')).toBe(true);
  });

  test('governance ignores diagnostic evidence when operational evidence exists', () => {
    const replay = {
      replayId: 'mixed',
      journeyId: 'support_ticket_flow',
      afterSnapshot: { state: 'mixed' },
      steps: [
        {
          id: 'step_reply_ticket',
          actionType: 'type_and_send',
          evidenceClassification: 'operational',
          page: '/support',
          url: '/support',
          selectorUsed: '#reply',
          screenshotBefore: 'before.png',
          screenshotAfter: 'after.png',
          networkEvents: [response('POST', '/api/tickets/1/reply', 201)],
          evidenceId: 'op-step',
          mutationLinkage: { correlatedBy: 'step_incremental', mutationCount: 1 },
          observedMutations: ['message_created'],
          observedSideEffects: ['audit_log_created'],
          mutationProvenance: [{
            mutation: 'message_created',
            originatingStepId: 'step_reply_ticket',
            originatingActionType: 'type_and_send',
            originatingNetworkEvent: { method: 'POST', url: '/api/tickets/1/reply', status: 201 },
            entityScope: ['ticket', 'messages'],
            beforeStepSnapshotHash: 'aaaa1111',
            afterStepSnapshotHash: 'bbbb2222',
            correlatedBy: 'network_linkage',
            valid: true,
            reason: null,
          }],
        },
        {
          id: 'diagnostic-step',
          actionType: 'click',
          evidenceClassification: 'diagnostic_only',
          page: '/dev/qa-waves',
          url: '/dev/qa-waves',
        },
      ],
      screenshots: [{ path: 'after.png', description: 'mixed', timestamp: '2026-01-01T00:00:00.000Z', critical: true, type: 'validation' }],
      events: [{ type: 'api_call', page: '/support', module: 'support', operation: 'write', stateChange: true }],
      seedEvidence: { status: 'ready', ticketId: 't1', conversationId: 'c1', contactId: 'u1' },
      operationalSeedStatus: 'ready',
      rawStepCount: 2,
      rawScreenshotCount: 1,
    };

    const result = operationalReplayValidator.validateOperationalReplay(replay, { journeyId: 'support_ticket_flow' });
    expect(result.blockers.some((b) => b.reason === 'diagnostic_evidence_in_operational_replay')).toBe(false);
    expect(result.results.completeness.diagnosticStepsIgnored).toBe(1);
  });

  test('exact mutation mismatch is NO_GO', () => {
    const result = validatePostStateProof({
      beforeSnapshot: { db: { ticket: { status: 'open' } }, events: { audit: { count: 0 } } },
      afterSnapshot: { db: { ticket: { status: 'resolved' } }, events: { audit: { count: 1 } } },
      step: { id: 'step_reply_ticket', actionType: 'type_and_send' },
      journeyContext: blockingContext(),
    });

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingMutations).toEqual(['message_created']);
  });

  test('exact side effect mismatch is NO_GO', () => {
    const result = validatePostStateProof({
      beforeSnapshot: {
        db: { messages: { count: 1 } },
        events: { audit: { count: 0 }, notifications: { count: 0 } },
        crm: { activities: { count: 0 } },
      },
      afterSnapshot: {
        db: { messages: { count: 2 } },
        events: { audit: { count: 0 }, notifications: { count: 0 } },
        crm: { activities: { count: 1 } },
      },
      step: { id: 'step_reply_ticket', actionType: 'type_and_send' },
      journeyContext: blockingContext(),
    });

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.missingSideEffects).toEqual(['audit_log_created']);
  });
});
