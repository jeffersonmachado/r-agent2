'use strict';

const executor = require('../qa/operationalStepExecutor');

function blockingContext(journeyId = 'support_ticket_flow') {
  return {
    journeyId,
    executionMode: 'operational_go',
    isBlockingJourney: true,
  };
}

function makeReplyStep(overrides = {}) {
  return {
    id: 'step_reply_ticket',
    actionType: 'type_and_send',
    selectorUsed: '#reply',
    screenshotBefore: 'data:image/png;base64,before',
    screenshotAfter: 'data:image/png;base64,after',
    url: 'http://localhost/tickets/1',
    networkEvents: [
      {
        type: 'response',
        method: 'POST',
        url: 'http://localhost/api/tickets/1/reply',
        status: 201,
      },
    ],
    mutationExpected: true,
    ...overrides,
  };
}

function makeStatusStep(overrides = {}) {
  return {
    id: 'step_change_status',
    actionType: 'change_status',
    selectorUsed: '#status',
    screenshotBefore: 'data:image/png;base64,before',
    screenshotAfter: 'data:image/png;base64,after',
    url: 'http://localhost/tickets/1',
    networkEvents: [
      {
        type: 'response',
        method: 'PATCH',
        url: 'http://localhost/api/tickets/1/status',
        status: 200,
      },
    ],
    mutationExpected: true,
    ...overrides,
  };
}

function makeCheckinStep(overrides = {}) {
  return {
    id: 'step_submit_checkin',
    actionType: 'checkin_submit',
    selectorUsed: '#checkin',
    screenshotBefore: 'data:image/png;base64,before',
    screenshotAfter: 'data:image/png;base64,after',
    url: 'http://localhost/access/checkin',
    networkEvents: [
      {
        type: 'response',
        method: 'POST',
        url: 'http://localhost/api/fitness/checkin',
        status: 200,
      },
    ],
    mutationExpected: true,
    ...overrides,
  };
}

describe('step incremental state proof (causalidade operacional)', () => {
  test('reply_ticket: network OK mas messages.count igual => NO_GO', () => {
    const step = makeReplyStep({
      beforeStepSnapshot: { messages_count: 3, status: 'open' },
      afterStepSnapshot: { messages_count: 3, status: 'open' },
    });

    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { messages_count: 3, status: 'open' },
      afterSnapshot: { messages_count: 4, status: 'open' },
      executedSteps: [step],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: blockingContext('support_ticket_flow'),
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.steps[0].postStateProof.valid).toBe(false);
    expect(result.steps[0].postStateProof.blockers.some((b) => b.reason === 'post_state_proof_snapshot_unchanged')).toBe(true);
  });

  test('reply_ticket: messages.count mudou sem POST /reply => NO_GO', () => {
    const step = makeReplyStep({
      networkEvents: [
        {
          type: 'response',
          method: 'GET',
          url: 'http://localhost/api/tickets/1',
          status: 200,
        },
      ],
      beforeStepSnapshot: { messages_count: 3, status: 'open' },
      afterStepSnapshot: { messages_count: 4, status: 'open' },
    });

    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { messages_count: 3, status: 'open' },
      afterSnapshot: { messages_count: 4, status: 'open' },
      executedSteps: [step],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: blockingContext('support_ticket_flow'),
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'replay_step_missing_network_proof')).toBe(true);
  });

  test('change_status: PATCH ocorreu mas status igual => NO_GO', () => {
    const step = makeStatusStep({
      beforeStepSnapshot: { status: 'open' },
      afterStepSnapshot: { status: 'open' },
    });

    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { status: 'open' },
      afterSnapshot: { status: 'replied' },
      executedSteps: [step],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: blockingContext('support_ticket_flow'),
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.steps[0].postStateProof.blockers.some((b) => b.reason === 'post_state_proof_snapshot_unchanged')).toBe(true);
  });

  test('checkin_submit: endpoint OK mas attendance.count igual => NO_GO', () => {
    const step = makeCheckinStep({
      beforeStepSnapshot: { attendance_count: 0, access_decision: null },
      afterStepSnapshot: { attendance_count: 0, access_decision: 'allow' },
    });

    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { attendance_count: 0, access_decision: null },
      afterSnapshot: { attendance_count: 1, access_decision: 'allow' },
      executedSteps: [step],
      replay: { journeyId: 'fitness_customer_checkin', snapshotDiff: { changed: true } },
      journeyContext: blockingContext('fitness_customer_checkin'),
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'correlation_expected_mutations_missing')).toBe(true);
  });

  test('step correlation: mutação de um step não valida outro', () => {
    const replyStep = makeReplyStep({
      beforeStepSnapshot: {
        db: { messages: { count: 1 }, ticket: { status: 'open' } },
        events: { audit: { count: 0 }, notifications: { count: 0 } },
        crm: { activities: { count: 0 } },
      },
      afterStepSnapshot: {
        db: { messages: { count: 2 }, ticket: { status: 'open' } },
        events: { audit: { count: 1 }, notifications: { count: 1 } },
        crm: { activities: { count: 1 } },
      },
    });
    const statusStep = makeStatusStep({
      beforeStepSnapshot: { db: { ticket: { status: 'open' } } },
      afterStepSnapshot: { db: { ticket: { status: 'open' } } },
    });

    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { db: { messages: { count: 1 }, ticket: { status: 'open' } } },
      afterSnapshot: { db: { messages: { count: 2 }, ticket: { status: 'replied' } } },
      executedSteps: [replyStep, statusStep],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: blockingContext('support_ticket_flow'),
    });

    expect(result.steps[0].postStateProof.valid).toBe(true);
    expect(result.steps[1].postStateProof.valid).toBe(false);
    expect(result.steps[1].postStateProof.blockers.some((b) => b.reason === 'post_state_proof_snapshot_unchanged')).toBe(true);
  });

  test('journey: diff global sem diff incremental do step => NO_GO', () => {
    const stepWithoutIncrementalSnapshots = makeReplyStep({
      beforeStepSnapshot: null,
      afterStepSnapshot: null,
    });

    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { messages_count: 1, status: 'open' },
      afterSnapshot: { messages_count: 2, status: 'open' },
      executedSteps: [stepWithoutIncrementalSnapshots],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: blockingContext('support_ticket_flow'),
    });

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.steps[0].postStateProof.blockers.some((b) => b.reason === 'post_state_proof_missing_after_snapshot')).toBe(true);
  });
});
