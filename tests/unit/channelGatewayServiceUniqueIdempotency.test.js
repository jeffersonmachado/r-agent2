/**
 * Hardening: idempotência via UNIQUE no DB.
 *
 * Este teste valida que `ingestIncoming` trata unique violation como idempotente
 * (não falha o request) e retorna sucesso.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ChannelGatewayService - idempotência (unique violation)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('ingestIncoming trata UNIQUE violation como duplicata ignorada', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));

    const uniqueErr = Object.assign(new Error('duplicate key value violates unique constraint "channel_messages_tenant_channel_type_external_msg_id_uq"'), {
      name: 'SequelizeUniqueConstraintError',
      original: { code: '23505' },
    });

    const conversationRow = {
      id: 'conv1',
      update: jest.fn(async () => {}),
    };

    const ChannelConversation = () => ({
      findOne: jest.fn(async () => null),
      create: jest.fn(async () => conversationRow),
    });

    const ChannelMessage = () => ({
      findOne: jest.fn(async () => null),
      create: jest.fn(async () => { throw uniqueErr; }),
    });

    jest.doMock('../../api/db/models', () => ({
      ChannelAccount: () => ({}),
      ChannelConversation,
      ChannelMessage,
      OutboundQueueItem: () => ({}),
    }));

    // eslint-disable-next-line global-require
    const { ingestIncoming } = require('../../api/services/channelGatewayService');

    const payload = {
      message: {
        from: '5511999999999',
        id: 'wamid.in.dup',
        type: 'text',
        text: { body: 'oi' },
      },
      value: { metadata: { phone_number_id: 'pnid-1' } },
    };

    const res = await ingestIncoming('whatsapp', payload, { tenantId: 'tenant-1' });

    expect(res).toMatchObject({
      tenantId: 'tenant-1',
      persist: { persisted: true, idempotent: true, conversationId: 'conv1' },
    });
  });
});

