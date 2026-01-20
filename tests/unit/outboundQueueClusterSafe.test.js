/**
 * Hardening: worker outbound cluster-safe.
 *
 * Este teste valida que `processDue` usa lock + skipLocked dentro de transaction,
 * evitando dupla captura quando há múltiplas instâncias.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('OutboundQueueService - cluster-safe (skipLocked)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('processDue usa transaction + lock UPDATE + skipLocked', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/services/whatsappService', () => ({ sendTextMessage: jest.fn(async () => ({ messages: [{ id: 'wamid.out.1' }] })) }));
    jest.doMock('../../api/services/instagramService', () => ({ sendInstagramMessage: jest.fn(), sendInstagramMedia: jest.fn() }));
    jest.doMock('../../api/services/queueService', () => ({ updateOutboundMessageMeta: jest.fn(), getTicket: jest.fn() }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));
    jest.doMock('../../api/utils/config', () => ({ get: jest.fn() }));

    const findAll = jest.fn(async () => []);
    const update = jest.fn(async () => [0]);

    const fakeSequelize = {
      constructor: { Op: { lte: 'lte', is: 'is' } },
      transaction: async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
    };

    const OutboundQueueItem = () => ({
      sequelize: fakeSequelize,
      findAll,
      update,
    });

    jest.doMock('../../api/db/models', () => ({
      OutboundQueueItem,
      ChannelConversation: () => ({}),
      ChannelMessage: () => ({}),
    }));

    // eslint-disable-next-line global-require
    const { processDue } = require('../../api/services/outboundQueueService');

    const res = await processDue({ limit: 5 });

    expect(res).toMatchObject({ processed: 0, sent: 0, failed: 0 });
    expect(findAll).toHaveBeenCalledTimes(1);
    const args = findAll.mock.calls[0][0] || {};
    expect(args).toMatchObject({ skipLocked: true, lock: 'UPDATE' });
    expect(args.transaction).toBeTruthy();
  });
});

