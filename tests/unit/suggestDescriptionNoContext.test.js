/**
 * Teste: POST /system/suggest-description
 * - sem contexto indexado => 422 + Error Envelope (NO_INDEXED_CONTEXT)
 */

const http = require('http');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('POST /system/suggest-description - NO_INDEXED_CONTEXT_FALLBACK', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // Este teste pode ser mais lento em ambientes de CI (boot do server + mocks).
  test('retorna 200 + warning quando RAG não tem contexto indexado mas há fonte (urls/arquivos/site)', async () => {
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

    // Auth
    jest.doMock('../../api/services/authService', () => ({
      validateToken: jest.fn(() => ({
        valid: true,
        agent: { id: 'a1', username: 'u1', role: 'owner', tenantId: 't1', is_superadmin: false },
        session: { token: 't1' },
      })),
    }));
    jest.doMock('../../api/services/superAdminService', () => ({ isSuperAdmin: jest.fn(() => false) }));

    // Evita boot de workers/serviços não relevantes
    jest.doMock('../../api/services/outboundWorker', () => ({ start: jest.fn(), stop: jest.fn() }));
    jest.doMock('../../api/services/channelHealthService', () => ({ startChannelHealthMonitor: jest.fn() }));
    jest.doMock('../../api/services/handoverService', () => ({ startAutoReturnToBot: jest.fn(), takeOver: jest.fn(), returnToBot: jest.fn() }));
    jest.doMock('../../api/services/assignmentService', () => ({ startAssignmentWorker: jest.fn(), autoAssign: jest.fn() }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({ initialize: jest.fn(async () => {}) }));
    jest.doMock('../../api/services/queueService', () => ({ startAutoCleanup: jest.fn() }));
    jest.doMock('../../api/services/auditService', () => ({
      logAction: jest.fn(),
      queryLogs: jest.fn(async () => ([])),
      getAuditStats: jest.fn(async () => ({})),
      registerGeneration: jest.fn(async () => ({})),
      generateAuditReport: jest.fn(async () => ({})),
    }));

    // RAG vazio
    jest.doMock('../../api/services/ragService', () => ({
      isRagAvailable: jest.fn(async () => true),
      queryRag: jest.fn(async () => ({
        success: true,
        sources: [],
        response: '',
      })),
    }));

    // Evita depender de Redis/ephemeral context
    jest.doMock('../../api/services/ephemeralRagContextService', () => ({
      getEphemeralContext: jest.fn(async () => ({ found: false, used: false, chunks: [] })),
    }));

    // Força "sem contexto indexado" (RAG persistido vazio) para cair no fallback determinístico
    jest.doMock('../../api/services/ragContextBuilder', () => ({
      buildDiverseRagContext: jest.fn(async () => ({
        contextSources: [],
        contextSummary: { total: 0, uploaded: 0, web: 0, uploadedSources: [], webSources: [], topScores: { uploaded: [], web: [] } },
        notes: [],
        ragContext: '',
      })),
    }));

    // IA NÃO deve ser chamada
    const generateAiResponse = jest.fn(() => {
      throw new Error('IA não deveria ser chamada quando não há contexto indexado');
    });
    jest.doMock('../../api/services/aiProviderService', () => ({
      initializeAiProviders: jest.fn(async () => {}),
      ensureTenantAiConfigLoaded: jest.fn(async () => {}),
      generateAiResponse,
    }));

    // Provider ativo para o tenant (Gate 1 do endpoint)
    jest.doMock('../../engine/aiProviderManager', () => ({
      getAiProviderForTenant: jest.fn(() => ({ id: 'mock-provider' })),
    }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          port,
          path: '/system/suggest-description',
          headers: {
            Authorization: 'Bearer t1',
            'Content-Type': 'application/json',
            'X-Request-Id': 'req-test-1',
          },
        },
        (r) => {
          let data = '';
          r.on('data', (c) => { data += c; });
          r.on('end', () => {
            let body = null;
            try { body = JSON.parse(data); } catch { body = data; }
            resolve({ status: r.statusCode, headers: r.headers, body });
          });
        }
      );
      req.on('error', reject);
      req.write(JSON.stringify({
        prompt: 'Sugira uma descrição',
        name: 'Tenant Teste',
        tenantId: 't1',
        executionId: 'exec-test-1',
        urls: ['https://exemplo.com'],
      }));
      req.end();
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      suggestion: expect.any(String),
      warnings: expect.any(Array),
    }));
    expect(res.body.warnings[0]).toEqual(expect.objectContaining({
      code: 'NO_INDEXED_CONTEXT_FALLBACK',
    }));
    expect(generateAiResponse).not.toHaveBeenCalled();

    await new Promise((resolve) => server.close(resolve));
  }, 20000);
});

