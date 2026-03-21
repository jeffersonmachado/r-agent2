'use strict';

const { createEvidenceTimelineService } = require('../../api/services/evidenceTimelineService');

describe('evidenceTimelineService', () => {
  function makeGetter(api) {
    return () => api;
  }

  test('monta timeline consolidada com conversa, mensagens, ticket e eventos', async () => {
    const service = createEvidenceTimelineService({
      queueService: {
        getTicket: jest.fn(() => ({
          id: 't1',
          tenantId: 'tenant1',
          conversationId: 'c1',
          phoneNumber: '+5511999999999',
          lastUserMessage: 'cliente questiona aumento',
          context: { customerId: 'cust-1' },
          messages: [{ id: 'tm-1', sender: 'agent', text: 'Informamos o reajuste.', timestamp: '2026-02-10T12:00:00.000Z' }],
        })),
        listAllTickets: jest.fn(() => ({ tickets: [] })),
      },
      ChannelConversation: makeGetter({
        findAll: jest.fn(async () => [{ toJSON: () => ({ id: 'c1', channel_type: 'whatsapp', external_id: '+5511999999999', current_ticket_id: 't1', last_message_at: '2026-02-10T12:05:00.000Z', status: 'human' }) }]),
      }),
      ChannelMessage: makeGetter({
        findAll: jest.fn(async () => [{ toJSON: () => ({ id: 'm1', conversation_id: 'c1', channel_type: 'whatsapp', direction: 'outbound', type: 'text', body: { text: 'Informamos o reajuste anual.' }, created_at: '2026-02-10T12:01:00.000Z' }) }]),
      }),
      Ticket: makeGetter({
        findAll: jest.fn(async () => []),
        findOne: jest.fn(async () => null),
      }),
      AccessMembership: makeGetter({ findOne: jest.fn(async () => null) }),
      AccessSubject: makeGetter({ findOne: jest.fn(async () => null) }),
      eventLedgerService: {
        listEvents: jest.fn(async () => ({
          ok: true,
          items: [
            {
              id: 'evt-1',
              type: 'PriceNoticeLogged',
              subject_type: 'customer',
              subject_id: 'cust-1',
              actor_type: 'system',
              actor_id: 'system',
              occurred_at: '2026-02-10T12:02:00.000Z',
              payload: { ticketId: 't1', detail: 'formal notice' },
            },
          ],
        })),
      },
    });

    const result = await service.getTimeline({
      tenantId: 'tenant1',
      ticketId: 't1',
      identity: {
        entityType: 'customer',
        entityId: 'cust-1',
        relatedEntities: [{ type: 'ticket', id: 't1' }],
      },
      context: { ticketId: 't1' },
    });

    expect(result.ok).toBe(true);
    expect(result.items.map((item) => item.source)).toEqual(expect.arrayContaining([
      'channel_conversation',
      'channel_message',
      'ticket_message',
      'event_ledger',
    ]));
  });
});
