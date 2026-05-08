'use strict';

const { validatePostStateProof } = require('../../../qa/evidence/postStateProofValidator');
const POST_STATE_MODULE = '../../../qa/evidence/postStateProofValidator';

function loadExecutorUnmocked() {
  jest.resetModules();
  jest.dontMock(POST_STATE_MODULE);
  return require('../qa/operationalStepExecutor');
}

function makeBlockingContext() {
  return {
    journeyId: 'support_ticket_flow',
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
    url: 'http://localhost/tickets/123',
    domSnapshot: '<html></html>',
    networkEvents: [
      {
        type: 'response',
        method: 'POST',
        url: 'http://localhost/api/tickets/123/reply',
        status: 201,
      },
    ],
    ...overrides,
  };
}

describe('proof temporal pipeline - regras obrigatórias', () => {
  test('executeAndEnrichStep NÃO chama validatePostStateProof', async () => {
    jest.resetModules();
    const validatePostStateProofMock = jest.fn(() => ({ valid: true, blockers: [] }));

    jest.doMock(POST_STATE_MODULE, () => ({
      validatePostStateProof: validatePostStateProofMock,
      deriveObservedMutations: jest.fn(() => []),
      deriveObservedSideEffects: jest.fn(() => []),
      appendProofChainToReplay: jest.fn((step) => step),
    }));

    let executor;
    jest.isolateModules(() => {
      executor = require('../qa/operationalStepExecutor');
    });

    const result = await executor.executeAndEnrichStep(makeReplyStep(), null, {
      journeyId: 'support_ticket_flow',
      executionMode: 'diagnostic',
    });

    expect(result.executed).toBe(true);
    expect(validatePostStateProofMock).not.toHaveBeenCalled();

    jest.resetModules();
    jest.dontMock(POST_STATE_MODULE);
  });

  test('postStateProof sem afterSnapshot => FALHA', () => {
    const result = validatePostStateProof({
      beforeSnapshot: { messages_count: 1 },
      afterSnapshot: null,
      step: makeReplyStep(),
      journeyContext: makeBlockingContext(),
    });

    expect(result.valid).toBe(false);
    expect(result.blockers.some((b) => b.reason === 'post_state_proof_missing_after_snapshot')).toBe(true);
  });

  test('validateJourneyPostStateProofs com diff válido => PASSA', () => {
    const executor = loadExecutorUnmocked();
    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { messages_count: 1, status: 'open' },
      afterSnapshot: { messages_count: 2, status: 'open' },
      executedSteps: [makeReplyStep()],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: makeBlockingContext(),
    });

    expect(result.valid).toBe(true);
    expect(result.goNoGo).toBeNull();
    expect(result.steps[0].postStateProof.valid).toBe(true);
  });

  test('before == after => NO_GO', () => {
    const executor = loadExecutorUnmocked();
    const same = { messages_count: 1, status: 'open' };
    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: same,
      afterSnapshot: same,
      executedSteps: [makeReplyStep()],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: false } },
      journeyContext: makeBlockingContext(),
    });

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'replay_final_snapshot_unchanged')).toBe(true);
  });

  test('mutation sem side effect => NO_GO', () => {
    const executor = loadExecutorUnmocked();
    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { custom_count: 1 },
      afterSnapshot: { custom_count: 2 },
      executedSteps: [{
        id: 'step_backend_probe',
        actionType: 'assert_backend_state',
        screenshotAfter: 'data:image/png;base64,after',
      }],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: makeBlockingContext(),
    });

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'post_state_mutation_without_side_effect')).toBe(true);
  });

  test('replay step sem network proof => NO_GO', () => {
    const executor = loadExecutorUnmocked();
    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { messages_count: 1 },
      afterSnapshot: { messages_count: 2 },
      executedSteps: [makeReplyStep({ networkEvents: [] })],
      replay: { journeyId: 'support_ticket_flow', snapshotDiff: { changed: true } },
      journeyContext: makeBlockingContext(),
    });

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'replay_step_missing_network_proof')).toBe(true);
  });

  test('replay final sem snapshot diff => NO_GO', () => {
    const executor = loadExecutorUnmocked();
    const result = executor.validateJourneyPostStateProofs({
      beforeSnapshot: { messages_count: 1 },
      afterSnapshot: { messages_count: 2 },
      executedSteps: [makeReplyStep()],
      replay: { journeyId: 'support_ticket_flow' },
      journeyContext: makeBlockingContext(),
    });

    expect(result.valid).toBe(false);
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.blockers.some((b) => b.reason === 'replay_final_missing_snapshot_diff')).toBe(true);
  });
});
