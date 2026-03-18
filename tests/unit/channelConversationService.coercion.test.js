'use strict';

describe('channelConversationService coercion hardening', () => {
  let conversationFindAndCountAll;
  let ticketFindAll;
  const opIn = 'IN';

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    conversationFindAndCountAll = jest.fn(async () => ({
      count: 1,
      rows: [
        {
          id: 'conv-1',
          tenant_key: 'tenant-1',
          channel_type: 'whatsapp',
          external_id: 'ext-1',
          contact_id: 'contact-1',
          status: 'active',
          current_ticket_id: 'ticket-1',
          last_message_at: new Date('2026-03-18T10:00:00Z'),
          created_at: new Date('2026-03-18T09:00:00Z'),
          updated_at: new Date('2026-03-18T10:00:00Z'),
        },
      ],
    }));

    ticketFindAll = jest.fn(async () => ([{ id: 'ticket-1' }]));

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));

    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(() => ({
        sequelize: { constructor: { Op: { in: opIn } } },
        findAndCountAll: conversationFindAndCountAll,
      })),
      ChannelMessage: jest.fn(() => ({
        findAndCountAll: jest.fn(async () => ({ count: 0, rows: [] })),
      })),
      Ticket: jest.fn(() => ({
        findAll: ticketFindAll,
      })),
    }));
  });

  test('listConversations ignora status/channelType hostis sem estourar', async () => {
    const hostile = { toString() { throw new Error('boom-filter'); } };
    const { listConversations } = require('../../api/services/channelConversationService');

    const out = await listConversations({
      tenantId: 'tenant-1',
      status: hostile,
      channelType: hostile,
    });

    expect(out.total).toBe(1);
    expect(out.items).toHaveLength(1);

    const where = conversationFindAndCountAll.mock.calls[0][0].where;
    expect(where).toEqual({ tenant_key: 'tenant-1' });
  });

  test('listConversations ignora queue hostil sem consultar tickets', async () => {
    const hostileQueue = { toString() { throw new Error('boom-queue'); } };
    const { listConversations } = require('../../api/services/channelConversationService');

    const out = await listConversations({
      tenantId: 'tenant-1',
      queue: hostileQueue,
    });

    expect(out.total).toBe(1);
    expect(ticketFindAll).not.toHaveBeenCalled();

    const where = conversationFindAndCountAll.mock.calls[0][0].where;
    expect(where.current_ticket_id).toBeUndefined();
  });

  test('listConversations com queue valida aplica filtro por ticket ids', async () => {
    const { listConversations } = require('../../api/services/channelConversationService');

    await listConversations({
      tenantId: 'tenant-1',
      queue: 'sales',
    });

    expect(ticketFindAll).toHaveBeenCalledWith({
      where: { tenant_key: 'tenant-1', queue: 'sales' },
      attributes: ['id'],
      limit: 5000,
    });

    const where = conversationFindAndCountAll.mock.calls[0][0].where;
    expect(where.current_ticket_id).toEqual({ [opIn]: ['ticket-1'] });
  });
});
