/**
 * Testes de endpoint (Jest): /ai/chatbot/generate e /ai/rpa/generate
 * devem retornar o mesmo formato do orquestrador (/flows/generate),
 * pois agora são aliases.
 */

const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('Wrappers /ai/* como alias do orquestrador', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function startServerWithMocks() {
    // DB boot mocks
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    // Evita boot de workers/serviços não relevantes
    jest.doMock('../../api/services/outboundWorker', () => ({ start: jest.fn(), stop: jest.fn() }));
    jest.doMock('../../api/services/channelHealthService', () => ({ startChannelHealthMonitor: jest.fn() }));
    jest.doMock('../../api/services/handoverService', () => ({ startAutoReturnToBot: jest.fn() }));
    jest.doMock('../../api/services/assignmentService', () => ({ startAssignmentWorker: jest.fn() }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({ initialize: jest.fn(async () => {}) }));
    jest.doMock('../../api/services/queueService', () => ({ startAutoCleanup: jest.fn() }));
    jest.doMock('../../api/services/websocketService', () => ({
      initializeWebSocket: jest.fn(),
      emitEvent: jest.fn(),
    }));

    // Auth/tenant
    jest.doMock('../../api/middleware/auth', () => ({
      requireAuth: jest.fn((req) => {
        req.tenantId = 't1';
        req.agent = { id: 'a1', username: 'u1', tenantId: 't1' };
        return { valid: true, agent: req.agent };
      }),
      requirePermission: jest.fn(() => true),
    }));
    jest.doMock('../../api/services/superAdminService', () => ({ isSuperAdmin: jest.fn(() => false) }));

    // Orquestrador mockado
    jest.doMock('../../api/services/generationOrchestrator', () => ({
      orchestrateGeneration: jest.fn(async (payload) => ({
        success: true,
        flowDefinition: { id: payload?.name ? 'f1' : 'f1', tenantId: 't1', name: payload?.name || 'x', version: 1, nodes: [] },
        rpaTest: payload?.generateRpaTest ? { id: 'r1' } : null,
        validation: { flow: { valid: true, errors: [] }, contract: { valid: true, errors: [] }, bootstrap: null },
        metadata: null,
      })),
    }));

    const { createServer } = require('../../api/server');
    const server = createServer();
    return server;
  }

  async function httpPostJson({ port, path, body }) {
    const payload = JSON.stringify(body);
    const resBody = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          hostname: '127.0.0.1',
          port,
          path,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    return resBody;
  }

  test('/ai/chatbot/generate retorna shape do orquestrador', async () => {
    const server = startServerWithMocks();
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const res = await httpPostJson({
      port,
      path: '/ai/chatbot/generate',
      body: { userInput: 'x', options: { useRag: false } },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(parsed.flowDefinition).toBeDefined();
    expect(parsed.validationWarnings).toBeDefined();
  });

  test('/ai/rpa/generate retorna shape do orquestrador (com rpaTest)', async () => {
    const server = startServerWithMocks();
    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const res = await httpPostJson({
      port,
      path: '/ai/rpa/generate',
      body: { userInput: 'x', options: { rpaMode: 'infer' } },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(parsed.flowDefinition).toBeDefined();
    expect(parsed.rpaTest).toBeDefined();
    expect(parsed.validationWarnings).toBeDefined();
  });
});

