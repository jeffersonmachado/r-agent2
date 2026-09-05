'use strict';

/**
 * Realtime + unread no ingest inbound do Channel Gateway: após persistir
 * mensagem inbound, registra atividade (unread + conversation.message.received)
 * via channelConversationService — sempre best-effort.
 */

const mockRegisterInboundActivity = jest.fn();

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// Nota: resetMocks global — função estável delegando ao mock externo.
jest.mock('../../api/services/channelConversationService', () => ({
  registerInboundMessageActivity: (...a) => mockRegisterInboundActivity(...a),
}));

describe('channelGatewayService — atividade inbound (unread + WS)', () => {
  let conversationRow;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    conversationRow = { id: 'conv-1', update: jest.fn().mockResolvedValue(true) };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({ connectionManager: { pool: {} } })) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(conversationRow),
      })),
      ChannelMessage: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'msg-1', created_at: new Date('2026-09-05T10:00:00Z') }),
      })),
      ChannelAccount: jest.fn(() => ({ findOne: jest.fn() })),
    }));
    jest.doMock('../../api/services/queueService', () => ({ getTicketBySession: jest.fn(() => null) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));
    jest.doMock('../../api/utils/crypto', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
    mockRegisterInboundActivity.mockResolvedValue(undefined);
  });

  function whatsappPayload() {
    return {
      message: {
        id: 'wamid.INBOUND1',
        from: '5511999999999',
        type: 'text',
        text: { body: 'bom dia' },
      },
      value: { metadata: { phone_number_id: 'pnid-1' } },
    };
  }

  test('ingest inbound registra atividade (unread + evento WS) após persistir', async () => {
    // eslint-disable-next-line global-require
    const { ingestIncoming } = require('../../api/services/channelGatewayService');

    const out = await ingestIncoming('whatsapp', whatsappPayload(), { tenantId: 'tenant-1' });

    expect(out.persist.persisted).toBe(true);
    expect(out.persist.idempotent).toBe(false);
    expect(mockRegisterInboundActivity).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      channelType: 'whatsapp',
      message: expect.objectContaining({
        id: 'msg-1',
        direction: 'in',
        type: 'text',
        body: { text: 'bom dia' },
        createdAt: '2026-09-05T10:00:00.000Z',
      }),
    }));
  });

  test('falha na atividade inbound não quebra a persistência', async () => {
    mockRegisterInboundActivity.mockRejectedValue(new Error('ws/unread down'));
    // eslint-disable-next-line global-require
    const { ingestIncoming } = require('../../api/services/channelGatewayService');

    const out = await ingestIncoming('whatsapp', whatsappPayload(), { tenantId: 'tenant-1' });

    expect(out.persist.persisted).toBe(true);
    expect(out.persist.idempotent).toBe(false);
  });

  test('ingest idempotente (mensagem duplicada) não registra atividade de novo', async () => {
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(conversationRow),
        create: jest.fn().mockResolvedValue(conversationRow),
      })),
      ChannelMessage: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({ id: 'msg-existing' }),
        create: jest.fn(),
      })),
      ChannelAccount: jest.fn(() => ({ findOne: jest.fn() })),
    }));
    // eslint-disable-next-line global-require
    const { ingestIncoming } = require('../../api/services/channelGatewayService');

    const out = await ingestIncoming('whatsapp', whatsappPayload(), { tenantId: 'tenant-1' });

    expect(out.persist.idempotent).toBe(true);
    expect(mockRegisterInboundActivity).not.toHaveBeenCalled();
  });
});
