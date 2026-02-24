'use strict';

const { normalizeInboundEvent } = require('../normalizeInboundEvent');
const { validateNormalizedInboundEvent } = require('../../contracts/normalizedInboundEvent');

describe('normalizeInboundEvent', () => {
  test('normaliza payload legado WhatsApp para contrato único', () => {
    const { event, valid } = normalizeInboundEvent({
      message: {
        from: '5511999999999',
        id: 'wamid-1',
        text: { body: 'Quero orçamento' },
        timestamp: 1700000000,
      },
      value: {
        metadata: { phone_number_id: '123' },
      },
    }, {
      deps: {
        tenantId: 'tenant-a',
        channelType: 'whatsapp',
        sessionId: 'session-a',
        conversationId: 'conv-a',
      },
    });

    expect(valid).toBe(true);
    expect(event.channel).toBe('whatsapp');
    expect(event.media).toBe('text');
    expect(event.event_type).toBe('message');
    expect(event.direction).toBe('inbound');
    expect(event.tenant_id).toBe('tenant-a');
    expect(event.session_id).toBe('session-a');
    expect(event.voice_metadata).toEqual({});

    const validation = validateNormalizedInboundEvent(event);
    expect(validation.valid).toBe(true);
  });

  test('gera session_id/trace_id quando faltam campos', () => {
    const { event } = normalizeInboundEvent({ payload: { foo: 'bar' } }, { tenantId: 'tenant-b' });

    expect(event.session_id).toBeTruthy();
    expect(event.trace_id).toBeTruthy();
    expect(event.correlation_id).toBeTruthy();
    expect(event.voice_metadata).toEqual({});
  });
});
