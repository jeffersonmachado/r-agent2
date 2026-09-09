'use strict';

/**
 * Repair idempotente real (ensureOutboundQueued) — a UNIQUE parcial do banco é
 * a barreira final contra repairs concorrentes (INSERT ... ON CONFLICT DO
 * NOTHING). O harness em memória aplica a mesma semântica de conflito.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function buildHarness() {
  jest.resetModules();

  const rows = new Map(); // key `${tenant}::${clientMessageId}` → row

  const fakeSequelize = {
    query: jest.fn(async (sql, { replacements } = {}) => {
      // Emula INSERT ... ON CONFLICT (tenant_key, client_message_id) DO NOTHING
      if (/INSERT INTO outbound_queue/i.test(sql)) {
        const key = `${replacements.tenantKey}::${replacements.clientMessageId}`;
        if (!rows.has(key)) {
          rows.set(key, {
            id: replacements.id,
            tenant_key: replacements.tenantKey,
            client_message_id: replacements.clientMessageId,
            status: 'pending',
          });
        }
        return [[], 1];
      }
      return [[]];
    }),
  };

  const QueueModel = {
    sequelize: fakeSequelize,
    findOne: jest.fn(async ({ where } = {}) => rows.get(`${where.tenant_key}::${where.client_message_id}`) || null),
    create: jest.fn(async (data) => {
      const key = `${data.tenant_key}::${data.client_message_id}`;
      if (rows.has(key)) {
        const err = new Error('duplicate key value violates unique constraint "outbound_queue_tenant_client_msg_id_uq"');
        err.name = 'SequelizeUniqueConstraintError';
        err.original = { code: '23505' };
        throw err;
      }
      const row = { ...data };
      rows.set(key, row);
      return row;
    }),
  };

  jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
  jest.doMock('../../api/db/models', () => ({
    OutboundQueueItem: () => QueueModel,
    ChannelConversation: () => ({}),
    ChannelMessage: () => ({}),
    TicketEvent: () => ({}),
    OutboundAttempt: () => ({}),
  }));
  jest.doMock('../../api/services/whatsappService', () => ({ sendTextMessage: jest.fn() }));
  jest.doMock('../../api/services/instagramService', () => ({ sendInstagramMessage: jest.fn(), sendInstagramMedia: jest.fn() }));
  jest.doMock('../../api/services/messengerService', () => ({ sendMessengerMessage: jest.fn() }));
  jest.doMock('../../api/services/whatsappQrBridgeService', () => ({ sendTextViaConnection: jest.fn(), sendMediaViaConnection: jest.fn() }));
  jest.doMock('../../api/services/ticketMediaService', () => ({ getTicketMediaById: jest.fn() }));
  jest.doMock('../../api/services/queueService', () => ({ updateOutboundMessageMeta: jest.fn(), getTicket: jest.fn() }));
  jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));
  jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));
  jest.doMock('../../api/utils/config', () => ({ get: jest.fn() }));

  // eslint-disable-next-line global-require
  const service = require('../../api/services/outboundQueueService');
  return { service, rows };
}

describe('ensureOutboundQueued — repair idempotente de estado parcial', () => {
  test('queue ausente → repair cria exatamente 1 row pending com a mesma chave', async () => {
    const { service, rows } = buildHarness();

    const res = await service.ensureOutboundQueued({
      tenantId: 'tenant-1',
      channelType: 'whatsapp',
      conversationId: 'conv-1',
      message: { to: '5511', type: 'text', body: { text: 'oi' }, meta: { clientMessageId: 'cli-r1' } },
    });

    expect(res.repaired).toBe(true);
    expect(rows.size).toBe(1);
    expect(rows.get('tenant-1::cli-r1').status).toBe('pending');
  });

  test('queue já existe → idempotente, nenhum INSERT', async () => {
    const { service, rows } = buildHarness();
    rows.set('tenant-1::cli-r2', { id: 'outq-existing', tenant_key: 'tenant-1', client_message_id: 'cli-r2', status: 'sent' });

    const res = await service.ensureOutboundQueued({
      tenantId: 'tenant-1',
      channelType: 'whatsapp',
      conversationId: 'conv-1',
      message: { to: '5511', type: 'text', body: { text: 'oi' }, meta: { clientMessageId: 'cli-r2' } },
    });

    expect(res).toMatchObject({ queued: false, idempotent: true, itemId: 'outq-existing' });
    expect(rows.size).toBe(1);
    expect(rows.get('tenant-1::cli-r2').status).toBe('sent'); // não reabre item finalizado
  });

  test('repairs concorrentes da mesma ausência → 1 row, 0 duplicados (UNIQUE é a barreira final)', async () => {
    const { service, rows } = buildHarness();
    const input = {
      tenantId: 'tenant-1',
      channelType: 'whatsapp',
      conversationId: 'conv-1',
      message: { to: '5511', type: 'text', body: { text: 'oi' }, meta: { clientMessageId: 'cli-r3' } },
    };

    const [a, b] = await Promise.all([
      service.ensureOutboundQueued(input),
      service.ensureOutboundQueued(input),
    ]);

    expect(rows.size).toBe(1);
    const itemId = rows.get('tenant-1::cli-r3').id;
    expect(a.itemId).toBe(itemId);
    expect(b.itemId).toBe(itemId);
  });

  test('sem clientMessageId → repair não se aplica (chamador legado sem chave)', async () => {
    const { service, rows } = buildHarness();

    const res = await service.ensureOutboundQueued({
      tenantId: 'tenant-1',
      channelType: 'whatsapp',
      conversationId: 'conv-1',
      message: { to: '5511', type: 'text', body: { text: 'oi' }, meta: {} },
    });

    expect(res).toMatchObject({ queued: false, repaired: false, reason: 'client_message_id_missing' });
    expect(rows.size).toBe(0);
  });
});
