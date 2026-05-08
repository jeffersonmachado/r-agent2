'use strict';

const operationalReplayValidator = require('../qa/operationalReplayValidator');

function supportSnapshot(messageCount, status = 'open', crmCount = 0, auditCount = 0) {
  return {
    state: status === 'replied' ? 'crm_updated' : 'ticket_open',
    db: { ticketStatus: status, ticket: { exists: true, status, messages: { count: messageCount } } },
    api: { support: { ticketId: 'ticket-1', conversationId: 'conv-1' } },
    crm: { activities: { count: crmCount } },
    events: { audit: { count: auditCount } },
    metadata: { sources: { db: true, api: true, support: true, crm: true, audit: true } },
  };
}

function makeStrictSupportReplay(overrides = {}) {
  return {
    id: 'replay-1',
    journeyId: 'support_ticket_flow',
    initialState: 'ticket_open',
    transitionState: 'ticket_replied',
    finalState: 'crm_updated',
    beforeSnapshot: supportSnapshot(1, 'open', 0, 0),
    afterSnapshot: supportSnapshot(2, 'replied', 1, 1),
    seedEvidence: {
      journeyId: 'support_ticket_flow',
      status: 'ready',
      ticketId: 'ticket-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
    },
    operationalSeedStatus: 'ready',
    steps: [
      {
        id: 'step-1',
        type: 'click',
        actionType: 'click',
        page: '/support',
        url: '/support',
        selector: '[data-testid="ticket-list"]',
        selectorUsed: '[data-testid="ticket-list"]',
        timestamp: '2026-05-07T10:00:00.000Z',
        screenshotBefore: 'step-1-before.png',
        screenshotAfter: 'step-1.png',
        networkEvents: [{ type: 'response', url: '/api/support/tickets', method: 'GET', status: 200 }],
        evidenceId: 'evidence-step-1',
        mutationLinkage: { stepId: 'step-1', mutationCount: 1 },
        stepResult: { status: 'success' },
      },
      {
        id: 'step-2',
        type: 'click',
        actionType: 'click',
        page: '/support',
        url: '/support/ticket/TICKET-1',
        selector: '[data-testid="ticket-detail"]',
        selectorUsed: '[data-testid="ticket-detail"]',
        timestamp: '2026-05-07T10:00:01.000Z',
        screenshotBefore: 'step-2-before.png',
        screenshotAfter: 'step-2.png',
        networkEvents: [{ type: 'response', url: '/api/support/tickets/TICKET-1', method: 'GET', status: 200 }],
        evidenceId: 'evidence-step-2',
        mutationLinkage: { stepId: 'step-2', mutationCount: 1 },
        stepResult: { status: 'success' },
      },
      {
        id: 'step-3',
        type: 'fill',
        actionType: 'type_and_send',
        page: '/support',
        url: '/support/ticket/TICKET-1',
        selector: '[data-testid="ticket-send-button"]',
        selectorUsed: '[data-testid="ticket-send-button"]',
        dataTestId: 'ticket-send-button',
        timestamp: '2026-05-07T10:00:02.000Z',
        screenshotBefore: 'step-3-before.png',
        screenshotAfter: 'step-3.png',
        networkEvents: [{ type: 'response', url: '/api/support/tickets/TICKET-1/reply', method: 'POST', status: 200 }],
        evidenceId: 'evidence-step-3',
        mutationLinkage: { stepId: 'step-3', mutationCount: 2 },
        stepResult: { status: 'success' },
      },
    ],
    screenshots: [
      {
        id: 'ss-1',
        path: 'step-1.png',
        description: 'ticket list',
        timestamp: '2026-05-07T10:00:00.000Z',
      },
      {
        id: 'ss-2',
        path: 'step-2.png',
        description: 'ticket detail',
        timestamp: '2026-05-07T10:00:01.000Z',
      },
      {
        id: 'ss-3',
        path: 'step-3.png',
        description: 'ticket replied',
        timestamp: '2026-05-07T10:00:03.000Z',
        critical: true,
        type: 'validation',
      },
    ],
    events: [
      { type: 'click', page: '/support', module: 'support', entity: 'ticket', operation: 'read', timestamp: '2026-05-07T10:00:00.000Z' },
      {
        type: 'api_call',
        action: 'reply_ticket',
        dataTestId: 'ticket-send-button',
        selector: 'ticket-send-button',
        page: '/support',
        module: 'support',
        entity: 'ticket',
        operation: 'update',
        stateChange: true,
        timestamp: '2026-05-07T10:00:02.000Z',
      },
      { type: 'api_call', page: '/support', module: 'crm', entity: 'crm', operation: 'write', stateChange: true, timestamp: '2026-05-07T10:00:02.500Z' },
      { type: 'event', page: '/support', module: 'audit', entity: 'audit', operation: 'insert', stateChange: true, timestamp: '2026-05-07T10:00:03.000Z' },
      { type: 'notification', page: '/support', module: 'support', entity: 'notification', operation: 'send', timestamp: '2026-05-07T10:00:03.100Z' },
    ],
    auditLog: [{ id: 'audit-1' }],
    ...overrides,
  };
}

describe('operationalReplayValidator strict replay gates', () => {
  test('retorna NO_GO quando replay nao possui screenshot', () => {
    const result = operationalReplayValidator.validateOperationalReplay(makeStrictSupportReplay({ screenshots: [] }), { journeyId: 'support_ticket_flow' });

    expect(result.isOperational).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'missing_operational_screenshots')).toBe(true);
  });

  test('retorna NO_GO quando replay nao possui screenshotBefore', () => {
    const result = operationalReplayValidator.validateOperationalReplay(
      makeStrictSupportReplay({
        steps: makeStrictSupportReplay().steps.map((step) => ({ ...step, screenshotBefore: null })),
      }),
      { journeyId: 'support_ticket_flow' }
    );

    expect(result.isOperational).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'replay_step_missing_screenshot_before')).toBe(true);
  });

  test('retorna NO_GO quando replay nao possui networkEvents', () => {
    const result = operationalReplayValidator.validateOperationalReplay(
      makeStrictSupportReplay({
        steps: makeStrictSupportReplay().steps.map((step) => ({ ...step, networkEvents: [] })),
      }),
      { journeyId: 'support_ticket_flow' }
    );

    expect(result.isOperational).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'replay_step_missing_network_events')).toBe(true);
  });

  test('retorna NO_GO quando replay nao possui evidenceId', () => {
    const result = operationalReplayValidator.validateOperationalReplay(
      makeStrictSupportReplay({
        steps: makeStrictSupportReplay().steps.map((step) => ({ ...step, evidenceId: null })),
      }),
      { journeyId: 'support_ticket_flow' }
    );

    expect(result.isOperational).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'replay_step_missing_evidence_id')).toBe(true);
  });

  test('retorna NO_GO quando replay nao possui mutation linkage', () => {
    const result = operationalReplayValidator.validateOperationalReplay(
      makeStrictSupportReplay({
        steps: makeStrictSupportReplay().steps.map((step) => ({ ...step, mutationLinkage: null })),
      }),
      { journeyId: 'support_ticket_flow' }
    );

    expect(result.isOperational).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'replay_step_missing_mutation_linkage')).toBe(true);
  });

  test('retorna NO_GO quando support replay nao possui seed operacional', () => {
    const result = operationalReplayValidator.validateOperationalReplay(
      makeStrictSupportReplay({ seedEvidence: null, operationalSeedStatus: 'missing' }),
      { journeyId: 'support_ticket_flow' }
    );

    expect(result.isOperational).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'operational_seed_missing')).toBe(true);
  });

  test('retorna NO_GO quando replay nao possui steps', () => {
    const result = operationalReplayValidator.validateOperationalReplay(makeStrictSupportReplay({ steps: [] }), { journeyId: 'support_ticket_flow' });

    expect(result.isOperational).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'replay_steps_empty')).toBe(true);
  });

  test('retorna NO_GO quando replay navega apenas em paginas diagnosticas', () => {
    const result = operationalReplayValidator.validateOperationalReplay(
      makeStrictSupportReplay({
        steps: [
          {
            id: 'diag-step',
            type: 'click',
            actionType: 'click',
            page: '/dev/qa-waves',
            url: '/dev/qa-waves',
            selector: '[data-testid="diagnostic"]',
            timestamp: '2026-05-07T10:00:00.000Z',
            screenshotAfter: 'diag.png',
          },
        ],
        screenshots: [
          {
            id: 'diag-ss',
            path: 'diag.png',
            description: '/dev/qa-waves',
            timestamp: '2026-05-07T10:00:00.000Z',
            critical: true,
            type: 'validation',
          },
        ],
        events: [
          { type: 'click', page: '/dev/qa-waves', module: 'qa', entity: 'diagnostic', operation: 'read', timestamp: '2026-05-07T10:00:00.000Z' },
        ],
      }),
      { journeyId: 'support_ticket_flow' }
    );

    expect(result.isOperational).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'replay_not_operational')).toBe(true);
  });

  test('retorna NO_GO quando mutationCount = 0', () => {
    const snap = supportSnapshot(1, 'open', 0, 0);
    const result = operationalReplayValidator.validateOperationalReplay(
      makeStrictSupportReplay({
        beforeSnapshot: snap,
        afterSnapshot: snap,
      }),
      { journeyId: 'support_ticket_flow' }
    );

    expect(result.isOperational).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'missing_real_state_mutation')).toBe(true);
  });

  test('retorna NO_GO quando side effect obrigatorio esta ausente', () => {
    const result = operationalReplayValidator.validateOperationalReplay(
      makeStrictSupportReplay({
        events: [
          { type: 'click', page: '/support', module: 'support', entity: 'ticket', operation: 'read', timestamp: '2026-05-07T10:00:00.000Z' },
          {
            type: 'api_call',
            action: 'reply_ticket',
            dataTestId: 'ticket-send-button',
            selector: 'ticket-send-button',
            page: '/support',
            module: 'support',
            entity: 'ticket',
            operation: 'update',
            stateChange: true,
            timestamp: '2026-05-07T10:00:02.000Z',
          },
        ],
        auditLog: [],
      }),
      { journeyId: 'support_ticket_flow' }
    );

    expect(result.isOperational).toBe(false);
    const transitionFailure = result.results.stateAware.blockers.find((item) => item.reason === 'transition_failed');
    expect(transitionFailure).toBeTruthy();
    expect((transitionFailure.transition?.blockers || []).some((item) => item.reason === 'missing_side_effects')).toBe(true);
  });
});
