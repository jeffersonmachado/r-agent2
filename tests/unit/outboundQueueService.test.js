/**
 * Testes unitários do OutboundQueueService (Fase 1 - retry/backoff)
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('OutboundQueueService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.ALLOW_DIRECT_SEND_WITHOUT_DB;
    delete process.env.NODE_ENV;
  });

  test('computeBackoffSeconds cresce (com cap) conforme tentativas', () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/whatsappService', () => ({ sendTextMessage: jest.fn() }));
    jest.doMock('../../api/services/instagramService', () => ({ sendInstagramMessage: jest.fn(), sendInstagramMedia: jest.fn() }));
    jest.doMock('../../api/services/queueService', () => ({ updateOutboundMessageMeta: jest.fn(), getTicket: jest.fn() }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));
    jest.doMock('../../api/utils/config', () => ({ get: jest.fn() }));

    // eslint-disable-next-line global-require
    const { _computeBackoffSeconds } = require('../../api/services/outboundQueueService');

    const a0 = _computeBackoffSeconds(0);
    const a1 = _computeBackoffSeconds(1);
    const a2 = _computeBackoffSeconds(2);
    const a6 = _computeBackoffSeconds(6);

    expect(a0).toBeGreaterThanOrEqual(2);
    expect(a1).toBeGreaterThanOrEqual(a0);
    expect(a2).toBeGreaterThanOrEqual(a1);
    expect(a6).toBeLessThanOrEqual(305); // cap 300 + jitter
  });

  test('enqueueOutbound em production sem DB falha (sem envio direto)', async () => {
    process.env.NODE_ENV = 'production';
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    const sendTextMessage = jest.fn(async () => ({ messages: [{ id: 'wamid.out.1' }] }));
    jest.doMock('../../api/services/whatsappService', () => ({ sendTextMessage }));
    jest.doMock('../../api/services/instagramService', () => ({ sendInstagramMessage: jest.fn(), sendInstagramMedia: jest.fn() }));
    jest.doMock('../../api/services/queueService', () => ({ updateOutboundMessageMeta: jest.fn(), getTicket: jest.fn() }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));
    jest.doMock('../../api/utils/config', () => ({ get: jest.fn() }));

    // eslint-disable-next-line global-require
    const { enqueueOutbound } = require('../../api/services/outboundQueueService');

    await expect(enqueueOutbound({
      tenantId: 'tenant-1',
      channelType: 'whatsapp',
      message: { to: '5511999999999', type: 'text', body: { text: 'oi' } },
    })).rejects.toThrow('db_unavailable_no_direct_send');

    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  test('enqueueOutbound em production sem DB permite envio direto quando flag está habilitada', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DIRECT_SEND_WITHOUT_DB = 'true';
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    const sendTextMessage = jest.fn(async () => ({ messages: [{ id: 'wamid.out.1' }] }));
    jest.doMock('../../api/services/whatsappService', () => ({ sendTextMessage }));
    jest.doMock('../../api/services/instagramService', () => ({ sendInstagramMessage: jest.fn(), sendInstagramMedia: jest.fn() }));
    jest.doMock('../../api/services/queueService', () => ({ updateOutboundMessageMeta: jest.fn(), getTicket: jest.fn() }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));
    jest.doMock('../../api/utils/config', () => ({ get: jest.fn() }));

    // eslint-disable-next-line global-require
    const { enqueueOutbound } = require('../../api/services/outboundQueueService');

    const res = await enqueueOutbound({
      tenantId: 'tenant-1',
      channelType: 'whatsapp',
      message: { to: '5511999999999', type: 'text', body: { text: 'oi' } },
    });

    expect(res).toMatchObject({ queued: false, direct: true });
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });

  test('enqueueOutbound deduplica por message.meta.clientMessageId quando DB disponível', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));

    const sequelize = {
      query: jest.fn(async () => [[{ id: 'outq-existing' }]]),
    };
    const Model = {
      sequelize,
      findOne: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'outq-new' })),
    };

    jest.doMock('../../api/db/models', () => ({
      OutboundQueueItem: () => Model,
      ChannelConversation: () => ({}),
      ChannelMessage: () => ({}),
      TicketEvent: () => ({}),
    }));
    jest.doMock('../../api/services/whatsappService', () => ({ sendTextMessage: jest.fn() }));
    jest.doMock('../../api/services/instagramService', () => ({ sendInstagramMessage: jest.fn(), sendInstagramMedia: jest.fn() }));
    jest.doMock('../../api/services/queueService', () => ({ updateOutboundMessageMeta: jest.fn(), getTicket: jest.fn() }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));
    jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));
    jest.doMock('../../api/utils/config', () => ({ get: jest.fn() }));

    // eslint-disable-next-line global-require
    const { enqueueOutbound } = require('../../api/services/outboundQueueService');

    const res = await enqueueOutbound({
      tenantId: 'tenant-1',
      channelType: 'whatsapp',
      message: { to: '5511999999999', type: 'text', body: { text: 'oi' }, meta: { clientMessageId: 'c1' } },
    });

    expect(res).toMatchObject({ queued: false, idempotent: true, itemId: 'outq-existing' });
    expect(Model.create).not.toHaveBeenCalled();
  });

  test('enqueueOutbound deduplica por externalMessageId quando fornecido', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));

    const sequelize = { query: jest.fn(async () => [[]]) };
    const Model = {
      sequelize,
      findOne: jest.fn(async () => ({ id: 'outq-existing2' })),
      create: jest.fn(async () => ({ id: 'outq-new' })),
    };

    jest.doMock('../../api/db/models', () => ({
      OutboundQueueItem: () => Model,
      ChannelConversation: () => ({}),
      ChannelMessage: () => ({}),
      TicketEvent: () => ({}),
    }));
    jest.doMock('../../api/services/whatsappService', () => ({ sendTextMessage: jest.fn() }));
    jest.doMock('../../api/services/instagramService', () => ({ sendInstagramMessage: jest.fn(), sendInstagramMedia: jest.fn() }));
    jest.doMock('../../api/services/queueService', () => ({ updateOutboundMessageMeta: jest.fn(), getTicket: jest.fn() }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));
    jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));
    jest.doMock('../../api/utils/config', () => ({ get: jest.fn() }));

    // eslint-disable-next-line global-require
    const { enqueueOutbound } = require('../../api/services/outboundQueueService');

    const res = await enqueueOutbound({
      tenantId: 'tenant-1',
      channelType: 'whatsapp',
      message: { to: '5511999999999', type: 'text', body: { text: 'oi' }, externalMessageId: 'wamid.out.1' },
    });

    expect(res).toMatchObject({ queued: false, idempotent: true, itemId: 'outq-existing2' });
    expect(Model.create).not.toHaveBeenCalled();
  });
});

