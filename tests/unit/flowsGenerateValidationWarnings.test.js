/**
 * Teste: POST /flows/generate deve retornar validationWarnings (não-bloqueante)
 * quando a validação do fluxo falhar.
 *
 * Observação: api/server.js tem inicialização em background ao importar.
 * Este teste usa mocks para evitar boot real de DB/serviços.
 */

const { Readable, Writable } = require('stream');

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

    const { _internal } = require('../../api/server');

    const payload = {
      name: 'Fluxo',
      description: 'qualquer',
      tenantId: 't1',
      useRag: false,
    };

    const { req, res, finished } = createMockReqRes({
      method: 'POST',
      url: '/flows/generate',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await _internal.requestHandler(req, res);
    await finished;

    const resPayload = res._body ? JSON.parse(res._body) : null;

    expect(res.statusCode).toBe(200);
    expect(resPayload.success).toBe(true);
    expect(resPayload.validationWarnings).toBeDefined();
    expect(resPayload.validationWarnings.valid).toBe(false);
    expect(resPayload.validationWarnings.codes).toContain('START_HAS_INPUTS');
    expect(Array.isArray(resPayload.validationWarnings.errors)).toBe(true);
  }, 30000);
});

function createMockReqRes({ method, url, headers, body }) {
  const req = new Readable({
    read() {}
  });
  req.method = method;
  req.url = url;
  req.headers = headers || {};
  req.connection = { remoteAddress: '127.0.0.1' };
  req.socket = req.connection;

  const resChunks = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      cb();
    },
  });
  res.statusCode = 200;
  res._headers = {};
  res._body = '';

  res.setHeader = (name, value) => {
    res._headers[String(name).toLowerCase()] = value;
  };
  res.getHeader = (name) => res._headers[String(name).toLowerCase()];
  res.writeHead = (statusCode, headersObj) => {
    res.statusCode = statusCode;
    if (headersObj) {
      Object.entries(headersObj).forEach(([key, value]) => res.setHeader(key, value));
    }
  };
  res.write = (chunk) => {
    resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  };

  let resolveFinished;
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });
  res.end = (chunk) => {
    if (chunk) {
      resChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    res._body = Buffer.concat(resChunks).toString('utf8');
    resolveFinished();
  };

  if (body) {
    req.push(body);
  }
  req.push(null);

  return { req, res, finished };
}
