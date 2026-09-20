/**
 * Teste de integração (mínimo): webhook WhatsApp não duplica mensagem no ticket
 * quando recebe o mesmo externalMessageId mais de uma vez (retry).
 */

const http = require('http');

// Boot do server + POST real levam ~9s ociosos; sob a carga do converge de
// governança o global de 10s (jest.config.cjs) estourou e derrubou RAP-075
// (medido na fase final do seal em 2026-09-20). Mesmo padrão das demais
// suítes de integração que sobem o server (evo*: 120s).
jest.setTimeout(120000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('webhook WhatsApp (idempotência)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('POST /webhooks/whatsapp: retry não duplica mensagem no ticket (modo human)', async () => {
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
        findOne: jest.fn(async () => ({
          id: 'conv1',
          tenant_key: 'tenant-1',
          channel_type: 'whatsapp',
          external_id: '5511999999999',
          current_ticket_id: null,
          update: jest.fn(async () => {}),
        })),
      }),
    }));

    // Mock do gateway para retornar conversationId/tenantId
    jest.doMock('../../api/services/channelGatewayService', () => ({
      updateStatus: jest.fn(async () => ({ updated: 0 })),
      ingestIncoming: jest.fn(async () => ({
        tenantId: 'tenant-1',
        normalized: { conversationKey: { externalId: '5511999999999' } },
        persist: { conversationId: 'conv1' },
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
    const queueService = require('../../api/services/queueService');
    // Cria ticket já em modo humano vinculado à conversa
    const ticket = queueService.createTicket({
      tenantId: 'tenant-1',
      sessionId: 'whatsapp_5511999999999',
      queue: 'suporte',
      lastUserMessage: null,
      context: { conversationId: 'conv1', channelType: 'whatsapp', mode: 'human' },
    });

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
                    id: 'wamid.in.1',
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
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.write(JSON.stringify(payload));
      req.end();
    });

    const r1 = await postOnce();
    const r2 = await postOnce();

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const msgs = queueService.getTicketMessages(ticket.id) || [];
    const match = msgs.filter((m) => m && m.externalMessageId === 'wamid.in.1');
    expect(match.length).toBe(1);

    // Engine deve ficar bloqueada quando ticket.mode=human
    // eslint-disable-next-line global-require
    const { processWhatsAppMessage } = require('../../api/services/messageProcessor');
    expect(processWhatsAppMessage).not.toHaveBeenCalled();

    await new Promise((resolve) => server.close(resolve));
  });
});
