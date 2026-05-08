'use strict';

const operationalStateEngine = require('../qa/operationalStateEngine');

describe('operationalStateEngine', () => {
  test('valida transicao operacional real com side effects e estado final', () => {
    const result = operationalStateEngine.evaluateTransition({
      journeyId: 'support_ticket_flow',
      transitionId: 'ticket_reply_transition',
      action: 'reply_ticket',
      initialState: 'ticket_open',
      transitionState: 'ticket_replied',
      finalState: 'crm_updated',
      beforeSnapshot: {
        state: 'ticket_open',
        db: { ticketStatus: 'open', ticket: { exists: true, status: 'open', messages: { count: 1 } } },
        api: { support: { ticketId: 'ticket-1', conversationId: 'conv-1' } },
        crm: { activities: { count: 0 } },
        events: { audit: { count: 0 } },
        metadata: { sources: { db: true, api: true, support: true, crm: true, audit: true } },
      },
      afterSnapshot: {
        state: 'crm_updated',
        db: { ticketStatus: 'replied', ticket: { exists: true, status: 'replied', messages: { count: 2 } } },
        api: { support: { ticketId: 'ticket-1', conversationId: 'conv-1' } },
        crm: { updated: true, activities: { count: 1 } },
        events: { audit: { count: 1 } },
        metadata: { sources: { db: true, api: true, support: true, crm: true, audit: true } },
      },
      observedSideEffects: ['crm_updated', 'notification_sent', 'audit_log_created'],
    });

    expect(result.valid).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(result.missingSideEffects).toEqual([]);
    expect(result.timeline.before).toBe('ticket_open');
    expect(result.timeline.after).toBe('crm_updated');
  });

  test('retorna NO_GO quando click nao produz mudanca de estado', () => {
    const flow = operationalStateEngine.evaluateOperationalStateFlow({
      transitions: [
        {
          journeyId: 'support_ticket_flow',
          transitionId: 'ticket_reply_transition',
          action: 'reply_ticket',
          initialState: 'ticket_open',
          transitionState: 'ticket_open',
          finalState: 'crm_updated',
          beforeSnapshot: { state: 'ticket_open' },
          afterSnapshot: { state: 'ticket_open' },
          observedSideEffects: [],
        },
      ],
    });

    expect(flow.goNoGo).toBe('NO_GO');
    expect(flow.blockers.some((item) => item.reason === 'transition_failed')).toBe(true);
    expect(flow.chain.coverage.operationalConsequenceCoverage).toBe(0);
  });

  test('retorna NO_GO quando snapshot obrigatorio esta ausente', () => {
    const result = operationalStateEngine.evaluateTransition({
      journeyId: 'support_ticket_flow',
      transitionId: 'ticket_reply_transition',
      action: 'reply_ticket',
      initialState: 'ticket_open',
      transitionState: 'ticket_replied',
      finalState: 'crm_updated',
      beforeSnapshot: {},
      afterSnapshot: {
        state: 'crm_updated',
        db: { ticketStatus: 'replied', ticket: { exists: true, status: 'replied', messages: { count: 2 } } },
        api: { support: { ticketId: 'ticket-1', conversationId: 'conv-1' } },
        crm: { updated: true, activities: { count: 1 } },
        events: { audit: { count: 1 } },
        metadata: { sources: { db: true, api: true, support: true, crm: true, audit: true } },
      },
      observedSideEffects: ['crm_updated', 'notification_sent', 'audit_log_created'],
    });

    expect(result.valid).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'snapshot_before_invalid')).toBe(true);
  });

  test('retorna NO_GO quando mutationCount e zero', () => {
    const snapshot = {
      state: 'ticket_open',
      db: { ticketStatus: 'open', ticket: { exists: true, status: 'open', messages: { count: 1 } } },
      api: { support: { ticketId: 'ticket-1', conversationId: 'conv-1' } },
      crm: { activities: { count: 0 } },
      events: { audit: { count: 0 } },
      metadata: { sources: { db: true, api: true, support: true, crm: true, audit: true } },
    };

    const result = operationalStateEngine.evaluateTransition({
      journeyId: 'support_ticket_flow',
      transitionId: 'ticket_reply_transition',
      action: 'reply_ticket',
      initialState: 'ticket_open',
      transitionState: 'ticket_replied',
      finalState: 'crm_updated',
      beforeSnapshot: snapshot,
      afterSnapshot: snapshot,
      observedSideEffects: ['crm_updated', 'notification_sent', 'audit_log_created'],
    });

    expect(result.valid).toBe(false);
    expect(result.blockers.some((item) => item.reason === 'missing_real_state_mutation')).toBe(true);
  });

  test('retorna NO_GO quando fonte obrigatoria está indisponivel', () => {
    const result = operationalStateEngine.evaluateTransition({
      journeyId: 'support_ticket_flow',
      transitionId: 'ticket_reply_transition',
      action: 'reply_ticket',
      initialState: 'ticket_open',
      transitionState: 'ticket_replied',
      finalState: 'crm_updated',
      beforeSnapshot: {
        state: 'ticket_open',
        db: { ticketStatus: 'open', ticket: { exists: true, status: 'open', messages: { count: 1 } } },
        metadata: {
          sources: { db: false, api: true, support: true, crm: true, audit: true },
          sourceErrors: ['db_source_unavailable'],
        },
      },
      afterSnapshot: {
        state: 'crm_updated',
        db: { ticketStatus: 'replied', ticket: { exists: true, status: 'replied', messages: { count: 2 } } },
        api: { support: { ticketId: 'ticket-1', conversationId: 'conv-1' } },
        crm: { updated: true, activities: { count: 1 } },
        events: { audit: { count: 1 } },
        metadata: { sources: { db: true, api: true, support: true, crm: true, audit: true } },
      },
      observedSideEffects: ['crm_updated', 'notification_sent', 'audit_log_created'],
    });

    expect(result.valid).toBe(false);
    expect(result.snapshotEvidence.before.blockers.some((item) => item.reason === 'snapshot_source_unavailable')).toBe(true);
  });

  test('retorna NO_GO quando fitness usa simulated_device', () => {
    const result = operationalStateEngine.evaluateTransition({
      journeyId: 'fitness_customer_checkin',
      transitionId: 'access_release_transition',
      action: 'turnstile_release',
      initialState: 'access_decision_allow',
      transitionState: 'turnstile_opened',
      finalState: 'crm_updated',
      beforeSnapshot: {
        state: 'membership_validated',
        db: {
          crm: { contact: { exists: true } },
          membership: { active: true },
          credential: { exists: true },
          attendance: { count: 0, created: false },
        },
        api: { access: { decision: { allow: true } } },
        devices: { mode: 'simulated_device', access: { events: 0 } },
        metadata: { sources: { db: true, api: true, crm: true, devices: true, attendance: true }, deviceEvidence: 'simulated_device' },
      },
      afterSnapshot: {
        state: 'attendance_created',
        db: {
          crm: { contact: { exists: true } },
          membership: { active: true },
          credential: { exists: true },
          attendance: { count: 1, created: true },
        },
        api: { access: { decision: { allow: true } } },
        devices: { mode: 'simulated_device', access: { events: 1, releaseEventCreated: true } },
        crm: { presenceActivity: { count: 1, created: true } },
        metadata: { sources: { db: true, api: true, crm: true, devices: true, attendance: true }, deviceEvidence: 'simulated_device' },
      },
      observedSideEffects: ['attendance_recorded', 'access_decision_allow', 'crm_presence_updated'],
    });

    expect(result.valid).toBe(false);
    expect(result.snapshotEvidence.before.blockers.some((item) => item.reason === 'snapshot_invalid_state')).toBe(true);
  });
});
