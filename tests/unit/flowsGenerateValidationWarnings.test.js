/**
 * Teste: POST /flows/generate deve retornar validationWarnings (não-bloqueante)
 * quando a validação do fluxo falhar.
 *
 * Observação: api/server.js tem inicialização em background ao importar.
 * Este teste usa mocks para evitar boot real de DB/serviços.
 */

const http = require('http');
const { TIMEOUT_BOOT_APP_MS } = require('../helpers/jestTimeouts');

jest.setTimeout(TIMEOUT_BOOT_APP_MS);

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

    const { createExpressApp } = require('../../api/server');

    const payload = {
      name: 'Fluxo',
      description: 'qualquer',
      tenantId: 't1',
      useRag: false,
    };

    const server = http.createServer(createExpressApp());
    let port = 0;

    try {
      const started = await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          port = address && typeof address === 'object' ? address.port : 0;
          resolve(true);
        });
        server.once('error', (err) => {
          if (err && err.code === 'EPERM') {
            resolve(false);
            return;
          }
          reject(err);
        });
      });

      if (!started) {
        return;
      }

      const response = await requestJson(port, 'POST', '/flows/generate', payload);
      const resPayload = response.body;

      expect(response.status).toBe(200);
      expect(resPayload.success).toBe(true);
      expect(resPayload.validationWarnings).toBeDefined();
      expect(resPayload.validationWarnings.valid).toBe(false);
      expect(resPayload.validationWarnings.codes).toContain('START_HAS_INPUTS');
      expect(Array.isArray(resPayload.validationWarnings.errors)).toBe(true);
    } finally {
      await new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    }
  }, 30000);
});

function requestJson(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }
          }
          resolve({
            status: res.statusCode || 0,
            body: parsed,
          });
        });
      },
    );

    req.on('error', reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}
