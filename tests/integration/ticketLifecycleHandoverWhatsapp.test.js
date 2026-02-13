/**
 * Teste de integração: ciclo mínimo do ticket (handover + envio + status + close)
 * - cria ticket manual
 * - takeover
 * - envia mensagem (ledger pending)
 * - simula status "read" via webhook (mock)
 * - fecha ticket
 */

const http = require('http');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ticket lifecycle (handover + whatsapp status + close)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('fluxo mínimo', async () => {
    let ticketIdRef = null;

    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    // status webhook: aplica update direto no ledger do ticket
    jest.doMock('../../api/services/channelGatewayService', () => ({
      updateStatus: jest.fn(async (_channelType, _payload) => {
        // eslint-disable-next-line global-require
        const { updateOutboundMessageMeta, getTicket } = require('../../api/services/queueService');
        const t = ticketIdRef ? getTicket(ticketIdRef) : null;
        if (!t) return { updated: 0 };
        const lastAgent = Array.isArray(t.messages) ? [...t.messages].reverse().find(m => m && m.sender === 'agent' && m.externalMessageId) : null;
        if (!lastAgent?.externalMessageId) return { updated: 0 };
        updateOutboundMessageMeta(t.id, { externalMessageId: lastAgent.externalMessageId, deliveryStatus: 'read' });
        return { updated: 1 };
      }),
      ingestIncoming: jest.fn(async () => null),
    }));

    // Evita WhatsApp real; outbound queue não roda worker neste teste
    jest.doMock('../../api/services/whatsappService', () => ({
      verifyWebhook: jest.fn(() => true),
      sendTextMessage: jest.fn(async () => ({ messages: [{ id: 'wamid.out.1' }] })),
    }));
    jest.doMock('../../api/services/outboundQueueService', () => ({
      enqueueOutbound: jest.fn(async () => ({ queued: true, itemId: 'outq-1' })),
    }));
    jest.doMock('../../api/services/closeReasonsService', () => ({
      initialize: jest.fn(async () => {}),
      ensureDefaultsForTenant: jest.fn(async () => {}),
      getCloseReason: jest.fn(() => null),
      getOrCreateCloseReasonByName: jest.fn(async ({ tenantId, name }) => ({
        success: true,
        reason: { id: 'cr-default', tenantId, name, active: true },
      })),
      listCloseReasons: jest.fn(() => []),
    }));

    // Auth: token fixo
    jest.doMock('../../api/services/authService', () => ({
      validateToken: jest.fn(() => ({
        valid: true,
        agent: { id: 'a1', username: 'agent1', role: 'admin', tenantId: 'tenant-1' },
        session: { id: 's1' },
      })),
    }));
    jest.doMock('../../api/services/rbacService', () => ({
      hasPermission: jest.fn(() => true),
      canAccessTicket: jest.fn(() => true),
      canModifyTicket: jest.fn(() => true),
    }));

    // eslint-disable-next-line global-require
    const queueService = require('../../api/services/queueService');
    // Cria ticket conhecido (id fixo)
    const created = queueService.createTicket({
      tenantId: 'tenant-1',
      sessionId: 'whatsapp_5511999999999',
      queue: 'suporte',
      lastUserMessage: null,
      context: {},
    });
    const ticketId = created.id;
    ticketIdRef = ticketId;

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    const listenResult = await new Promise((resolve, reject) => {
      const onError = (error) => {
        if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
          resolve({ skip: true });
          return;
        }
        reject(error);
      };
      server.once('error', onError);
      try {
        server.listen(0, '127.0.0.1', () => {
          server.off('error', onError);
          const address = server.address();
          if (address && typeof address === 'object') {
            resolve({ skip: false, port: address.port });
          } else {
            resolve({ skip: true });
          }
        });
      } catch (error) {
        server.off('error', onError);
        if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
          resolve({ skip: true });
          return;
        }
        reject(error);
      }
    });

    if (listenResult.skip) {
      return;
    }

    const port = listenResult.port;

    const reqJson = (method, path, body) => new Promise((resolve, reject) => {
      const req = http.request(
        { method, port, path, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' } },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          });
        }
      );
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });

    // takeover
    const r1 = await reqJson('POST', `/tickets/${ticketId}/takeover`, { reason: 'agent_takeover' });
    expect(r1.status).toBe(200);

    // send message (ledger pending)
    const r2 = await reqJson('POST', `/tickets/${ticketId}/message`, { message: 'Olá!' });
    expect(r2.status).toBe(200);

    // simula worker setando externalMessageId + sent
    const tAfterSend = queueService.getTicket(ticketId);
    const lastAgent = Array.isArray(tAfterSend?.messages) ? [...tAfterSend.messages].reverse().find(m => m && m.sender === 'agent') : null;
    expect(lastAgent).toBeTruthy();
    queueService.updateOutboundMessageMeta(ticketId, { clientMessageId: lastAgent.clientMessageId, externalMessageId: 'wamid.out.1', deliveryStatus: 'sent' });

    // webhook status "read"
    const webhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.out.1', status: 'read' }] } }] }],
    };
    const r3 = await new Promise((resolve, reject) => {
      const req = http.request(
        { method: 'POST', port, path: '/webhooks/whatsapp', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
        }
      );
      req.on('error', reject);
      req.write(JSON.stringify(webhookPayload));
      req.end();
    });
    expect(r3.status).toBe(200);

    const tAfterRead = queueService.getTicket(ticketId);
    const lastAgent2 = Array.isArray(tAfterRead?.messages) ? [...tAfterRead.messages].reverse().find(m => m && m.sender === 'agent') : null;
    expect(lastAgent2.deliveryStatus).toBe('read');

    // close
    const r4 = await reqJson('POST', `/tickets/${ticketId}/close`, { closeReasonName: 'Resolvido' });
    expect(r4.status).toBe(200);

    await new Promise((resolve) => server.close(resolve));
  });
});
