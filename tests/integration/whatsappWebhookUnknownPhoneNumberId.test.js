/**
 * Teste de integração (crítico): webhook WhatsApp com phone_number_id não cadastrado
 * deve ser ignorado com segurança (não cria ticket e não processa engine).
 */

const http = require('http');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('webhook WhatsApp (hardening multi-tenant)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('POST /webhooks/whatsapp: phone_number_id desconhecido não cria ticket e não roda engine', async () => {
    // Mocka inicialização pesada do server.js
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({
      defineRelationships: jest.fn(),
      ChannelConversation: () => ({
        findOne: jest.fn(async () => null),
      }),
    }));

    // Gateway retorna tenantId nulo para simular phone_number_id não cadastrado/ativo
    jest.doMock('../../api/services/channelGatewayService', () => ({
      updateStatus: jest.fn(async () => ({ updated: 0, reason: 'tenant_unresolved' })),
      ingestIncoming: jest.fn(async () => ({
        tenantId: null,
        normalized: { conversationKey: { externalId: '5511999999999' } },
        persist: { persisted: false, reason: 'tenant_unresolved' },
      })),
    }));

    // Evita dependências não relevantes do WhatsApp real
    jest.doMock('../../api/services/whatsappService', () => ({
      verifyWebhook: jest.fn(() => true),
      sendTextMessage: jest.fn(async () => ({ messages: [{ id: 'wamid.out.1' }] })),
    }));

    // Não queremos executar a engine nesse teste
    jest.doMock('../../api/services/messageProcessor', () => ({
      processWhatsAppMessage: jest.fn(async () => {}),
    }));

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
                metadata: { phone_number_id: 'pnid-unknown' },
                messages: [
                  {
                    from: '5511999999999',
                    id: 'wamid.in.unknown',
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

    const r = await new Promise((resolve, reject) => {
      const req = http.request(
        { method: 'POST', port, path: '/webhooks/whatsapp', headers: { 'Content-Type': 'application/json' } },
        (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.write(JSON.stringify(payload));
      req.end();
    });

    expect(r.status).toBe(200);

    // Engine não deve rodar se tenantId não foi resolvido
    // eslint-disable-next-line global-require
    const { processWhatsAppMessage } = require('../../api/services/messageProcessor');
    expect(processWhatsAppMessage).not.toHaveBeenCalled();

    // Não deve criar ticket
    // eslint-disable-next-line global-require
    const queueService = require('../../api/services/queueService');
    const result = queueService.listAllTickets();
    expect(result).toHaveProperty('tickets');
    expect(Array.isArray(result.tickets)).toBe(true);
    expect(result.tickets.length).toBe(0);

    await new Promise((resolve) => server.close(resolve));
  });
});
