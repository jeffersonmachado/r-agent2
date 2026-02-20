/**
 * Teste de integração: idempotência inbound hardening
 * - Se o Channel Gateway marcar a mensagem como idempotente (já persistida),
 *   o server NÃO deve criar ticket nem executar engine novamente.
 */

const http = require('http');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/services/whatsappQrRunner', () => {
  return class MockWhatsAppQrRunner {
    setInboundDepsProvider() {}
    getStatus() { return { status: 'disconnected' }; }
    getCachedQr() { return null; }
    async ensureSession() { return null; }
    async startSession() { return null; }
    async stopSession() { return null; }
  };
});

describe('webhook WhatsApp (idempotência hard gate)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('POST /webhooks/whatsapp: persist.idempotent=true impede criar ticket/rodar engine', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    // Gateway: marca idempotente sempre
    jest.doMock('../../api/services/channelGatewayService', () => ({
      updateStatus: jest.fn(async () => ({ updated: 0 })),
      ingestIncoming: jest.fn(async () => ({
        tenantId: 'tenant-1',
        normalized: { conversationKey: { externalId: '5511999999999' } },
        persist: { conversationId: 'conv1', idempotent: true },
      })),
    }));

    // Não queremos executar a engine
    const processWhatsAppMessage = jest.fn(async () => {});
    jest.doMock('../../api/services/messageProcessor', () => ({ processWhatsAppMessage }));

    jest.doMock('../../api/services/whatsappService', () => ({
      verifyWebhook: jest.fn(() => true),
      sendTextMessage: jest.fn(async () => ({ messages: [{ id: 'wamid.out.1' }] })),
    }));

    // eslint-disable-next-line global-require
    const queueService = require('../../api/services/queueService');

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

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messages: [
                  {
                    from: '5511999999999',
                    id: 'wamid.in.dup',
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: 'oi' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const postOnce = () => new Promise((resolve, reject) => {
      const req = http.request(
        { method: 'POST', port, path: '/webhooks/whatsapp', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode));
        }
      );
      req.on('error', reject);
      req.write(JSON.stringify(payload));
      req.end();
    });

    const status = await postOnce();
    expect(status).toBe(200);

    const all = queueService.listAllTickets({ tenantId: 'tenant-1', limit: 10000 });
    expect((all?.tickets || []).length).toBe(0);
    expect(processWhatsAppMessage).not.toHaveBeenCalled();

    await new Promise((resolve) => server.close(resolve));
  });
});
