'use strict';

const transitionInferenceService = require('../qa/transitionInferenceService');

describe('transitionInferenceService', () => {
  test('infere ticket-send-button como ticket_reply_transition', () => {
    const inferred = transitionInferenceService.inferTransitionFromStep({
      dataTestId: 'ticket-send-button',
      action: 'click',
      journeyId: 'support_ticket_flow',
    });

    expect(inferred.transitionId).toBe('ticket_reply_transition');
    expect(inferred.action).toBe('reply_ticket');
    expect(inferred.confidence).toBeGreaterThan(0.8);
  });

  test('infere turnstile-release como access_release_transition', () => {
    const inferred = transitionInferenceService.inferTransitionFromStep({
      dataTestId: 'turnstile-release',
      action: 'click',
      journeyId: 'fitness_customer_checkin',
    });

    expect(inferred.transitionId).toBe('access_release_transition');
    expect(inferred.action).toBe('turnstile_release');
  });
});
