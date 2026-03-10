'use strict';

const {
  createOperationalEvent,
  createOperationalSignal,
  createOperationalRecommendation,
  createOperationalDecision,
  createOperationalAction,
  createOperationalOutcome,
  createOperationalContext,
  createOperationalStateSnapshot,
} = require('..');

describe('operational contracts', () => {
  test('normaliza contratos canônicos básicos', () => {
    expect(createOperationalEvent({ tenant_id: 't1', event_type: 'message.received' })).toMatchObject({
      tenantId: 't1',
      type: 'message.received',
    });

    expect(createOperationalSignal({ tenant_id: 't1', signal_type: 'sla_risk' })).toMatchObject({
      tenantId: 't1',
      type: 'sla_risk',
      status: 'open',
    });

    expect(createOperationalRecommendation({ tenant_id: 't1', recommendation_type: 'handoff' })).toMatchObject({
      tenantId: 't1',
      type: 'handoff',
      status: 'open',
    });

    expect(createOperationalDecision({ source_type: 'recommendation', source_id: 'r1' })).toMatchObject({
      sourceType: 'recommendation',
      sourceId: 'r1',
    });

    expect(createOperationalAction({ tenant_id: 't1', action_id: 'notify' })).toMatchObject({
      tenantId: 't1',
      id: 'notify',
      status: 'requested',
    });

    expect(createOperationalOutcome({ tenant_key: 't1', outcome_type: 'resolved' })).toMatchObject({
      tenantId: 't1',
      outcomeType: 'resolved',
    });

    expect(createOperationalContext({ tenant_id: 't1', customer: { id: 'c1' } })).toMatchObject({
      tenantId: 't1',
      customer: { id: 'c1' },
    });

    expect(createOperationalStateSnapshot({ tenant_id: 't1', backlog: 12 })).toMatchObject({
      tenantId: 't1',
      backlog: 12,
    });
  });
});
