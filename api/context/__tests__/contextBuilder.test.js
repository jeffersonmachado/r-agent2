'use strict';

const { buildNormalizedContext } = require('../contextBuilder');

describe('contextBuilder', () => {
  test('monta NormalizedContext com evento + sessão', () => {
    const context = buildNormalizedContext({
      event: {
        tenant_id: 'tenant-a',
        session_id: 'sess-1',
        lead_id: '5511999999999',
        channel: 'whatsapp',
        media: 'text',
        trace_id: 'trace-1',
        timestamp: '2026-02-25T12:00:00.000Z',
        event_type: 'message',
      },
      session: {
        metadata: { channel: 'whatsapp' },
      },
      funnel_state: { stage: 'support', intent: 'support', severity: 'medium', next_action: 'educate' },
      tags: ['intent:support', 'severity:medium'],
      entities: {
        ticket_id: { value: 'T-123', source: 'regex', confidence: 0.8, updated_at: '2026-02-25T12:00:00.000Z' },
      },
      entity_meta: {
        ticket_id: { source: 'regex', confidence: 0.8, updated_at: '2026-02-25T12:00:00.000Z' },
      },
    });

    expect(context.tenant_id).toBe('tenant-a');
    expect(context.session_id).toBe('sess-1');
    expect(context.funnel_state.intent).toBe('support');
    expect(context.tags).toEqual(expect.arrayContaining(['intent:support', 'severity:medium']));
    expect(context.entities.ticket_id.value).toBe('T-123');
  });

  test('garante defaults quando dados ausentes', () => {
    const context = buildNormalizedContext({ event: { tenant_id: 't', session_id: 's', trace_id: 'x' } });
    expect(Array.isArray(context.tags)).toBe(true);
    expect(typeof context.entities).toBe('object');
    expect(context.funnel_state.severity).toBe('medium');
  });
});
