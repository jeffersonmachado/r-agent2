/**
 * Teste: POST /flows/generate deve retornar validationWarnings (não-bloqueante)
 * quando a validação do fluxo falhar.
 *
 * Observação: api/server.js tem inicialização em background ao importar.
 * Este teste usa mocks para evitar boot real de DB/serviços.
 */

const http = require('http');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('POST /flows/generate - validationWarnings', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('inclui validationWarnings com códigos de erro quando inválido', async () => {
    // DB boot mocks (evita conexões reais)
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

    // Middleware/auth: não precisamos autenticar para usar tenantId no body
    jest.doMock('../../api/middleware/auth', () => ({
      requireAuth: jest.fn((req) => {
        // Simula middleware real: resolve tenant no request quando token é válido
        req.tenantId = 't1';
        req.agent = { id: 'a1', username: 'u1', tenantId: 't1' };
        return { valid: true, agent: req.agent };
      }),
      requirePermission: jest.fn(() => true),
    }));

    // Orquestrador: retorna validação inválida
    jest.doMock('../../api/services/generationOrchestrator', () => ({
      orchestrateGeneration: jest.fn(async () => ({
        success: true,
        flowDefinition: { tenantId: 't1', id: 'f1', name: 'Fluxo', version: 1, nodes: [] },
        metadata: null,
        validation: {
          flow: {
            valid: false,
            errors: [
              {
                code: 'START_HAS_INPUTS',
                message: 'start não pode ter entradas',
                messageUi: 'O nó start não pode ter entradas.',
                severity: 'error',
                nodeIds: ['start'],
              },
            ],
          },
        },
      })),
    }));

    // Auditoria: best-effort
    jest.doMock('../../api/services/auditService', () => ({
      registerGeneration: jest.fn(async () => 'audit-1'),
      generateAuditReport: jest.fn(async () => ({ reportId: 'r1' })),
      logAction: jest.fn(),
      queryLogs: jest.fn(async () => []),
      getAuditStats: jest.fn(async () => ({})),
    }));

    const { createServer } = require('../../api/server');
    const server = createServer();

    await new Promise((resolve) => server.listen(0, resolve));
    const { port } = server.address();

    const payload = JSON.stringify({
      name: 'Fluxo',
      description: 'qualquer',
      tenantId: 't1',
      useRag: false,
    });

    const resBody = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          hostname: '127.0.0.1',
          port,
          path: '/flows/generate',
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

    await new Promise((resolve) => server.close(resolve));

    expect(resBody.status).toBe(200);
    const parsed = JSON.parse(resBody.body);
    expect(parsed.success).toBe(true);
    expect(parsed.validationWarnings).toBeDefined();
    expect(parsed.validationWarnings.valid).toBe(false);
    expect(parsed.validationWarnings.codes).toContain('START_HAS_INPUTS');
    expect(Array.isArray(parsed.validationWarnings.errors)).toBe(true);
  }, 30000);
});

