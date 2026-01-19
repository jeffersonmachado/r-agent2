/**
 * Testes unitários do ChannelGatewayService (Fase 1 - Omnichannel)
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ChannelGatewayService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('normalizeIncoming(whatsapp) normaliza mensagem de texto', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/queueService', () => ({ getTicketBySession: jest.fn(() => null) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));

    // eslint-disable-next-line global-require
    const { normalizeIncoming } = require('../../api/services/channelGatewayService');

    const payload = {
      message: {
        id: 'wamid.ABC123',
        from: '5511999999999',
        type: 'text',
        text: { body: 'Olá' },
      },
      value: { metadata: { phone_number_id: '12345' } },
    };

    const out = normalizeIncoming('whatsapp', payload);
    expect(out.conversationKey.channelType).toBe('whatsapp');
    expect(out.conversationKey.externalId).toBe('5511999999999');
    expect(out.message.direction).toBe('in');
    expect(out.message.type).toBe('text');
    expect(out.message.body).toEqual({ text: 'Olá' });
    expect(out.message.externalMessageId).toBe('wamid.ABC123');
  });

  test('normalizeIncoming(instagram) normaliza mensagem de texto', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/queueService', () => ({ getTicketBySession: jest.fn(() => null) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));

    // eslint-disable-next-line global-require
    const { normalizeIncoming } = require('../../api/services/channelGatewayService');

    const payload = {
      messaging: {
        sender: { id: 'ig-user-1' },
        recipient: { id: 'ig-page-1' },
        message: { mid: 'mid.1', text: 'Oi IG' },
      },
    };

    const out = normalizeIncoming('instagram', payload);
    expect(out.conversationKey.channelType).toBe('instagram');
    expect(out.conversationKey.externalId).toBe('ig-user-1');
    expect(out.message.type).toBe('text');
    expect(out.message.body).toEqual({ text: 'Oi IG' });
    expect(out.message.externalMessageId).toBe('mid.1');
  });

  test('ingestIncoming aplica idempotência por externalMessageId', async () => {
    const mockConversation = {
      id: 'conv-1',
      update: jest.fn().mockResolvedValue(true),
    };

    const ChannelConversationModel = {
      findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(mockConversation),
      create: jest.fn().mockResolvedValue(mockConversation),
    };

    const ChannelMessageModel = {
      findOne: jest.fn()
        .mockResolvedValueOnce(null) // primeira ingest: não existe
        .mockResolvedValueOnce({ id: 'msg-existing' }), // segunda ingest: já existe
      create: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({ connectionManager: { pool: {} } })) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: jest.fn(() => ChannelConversationModel),
      ChannelMessage: jest.fn(() => ChannelMessageModel),
      ChannelAccount: jest.fn(() => ({ findOne: jest.fn() })),
    }));
    jest.doMock('../../api/services/queueService', () => ({ getTicketBySession: jest.fn(() => null) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));
    jest.doMock('../../api/utils/crypto', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));

    // eslint-disable-next-line global-require
    const { ingestIncoming } = require('../../api/services/channelGatewayService');

    const payload = {
      message: {
        id: 'wamid.IDEMPOTENT',
        from: '5511888777666',
        type: 'text',
        text: { body: 'ping' },
      },
      value: { metadata: { phone_number_id: 'pnid-1' } },
    };

    const first = await ingestIncoming('whatsapp', payload, { tenantId: 'tenant-1' });
    expect(first.persist.persisted).toBe(true);
    expect(first.persist.idempotent).toBe(false);
    expect(ChannelMessageModel.create).toHaveBeenCalledTimes(1);

    const second = await ingestIncoming('whatsapp', payload, { tenantId: 'tenant-1' });
    expect(second.persist.persisted).toBe(true);
    expect(second.persist.idempotent).toBe(true);
    expect(ChannelMessageModel.create).toHaveBeenCalledTimes(1);
  });
});

