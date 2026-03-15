const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('POST /system/pipeline/validate-prereqs', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  async function listenOrSkip(server) {
    return new Promise((resolve, reject) => {
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
          if (!address || typeof address !== 'object') {
            resolve({ skip: true });
            return;
          }
          resolve({ skip: false, port: address.port });
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
  }

  async function httpPostJson({ port, path, body }) {
    const payload = JSON.stringify(body || {});

    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          hostname: '127.0.0.1',
          port,
          path,
          headers: {
            Authorization: 'Bearer fake-token',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(data) });
            } catch (_) {
              resolve({ status: res.statusCode, body: data });
            }
          });
        }
      );

      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  function startServerWithMocks(overrides = {}) {
    const defaultAgent = overrides.defaultAgent || { id: 'a1', username: 'systemadmin', tenantId: 'system', role: 'owner' };
    const requireAuthImpl = overrides.requireAuth || jest.fn((req) => {
      req.agent = defaultAgent;
      req.tenantId = defaultAgent.tenantId;
      return { valid: true, agent: defaultAgent };
    });
    const getAIConfigImpl = overrides.getAIConfig || jest.fn(async () => ({ primary: 'openai', configured: true }));
    const getDecryptedAPIKeyImpl = overrides.getDecryptedAPIKey || jest.fn(async () => 'sk-test');
    const checkRagServiceStatusImpl = overrides.checkRagServiceStatus || jest.fn(async () => ({ status: 'healthy' }));

    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    jest.doMock('../../api/services/websocketService', () => ({
      initializeWebSocket: jest.fn(),
      emitEvent: jest.fn(),
    }));

    jest.doMock('../../api/middleware/auth', () => ({
      requireAuth: requireAuthImpl,
      requirePermission: jest.fn(() => true),
    }));

    jest.doMock('../../api/services/superAdminService', () => ({
      isSuperAdmin: jest.fn(() => false),
      listAllTenants: jest.fn(async () => ({ success: true, tenants: [] })),
      getTenantMetrics: jest.fn(async () => ({ success: true })),
      impersonateUser: jest.fn(async () => ({ success: true })),
      blockTenant: jest.fn(async () => ({ success: true })),
      unblockTenant: jest.fn(async () => ({ success: true })),
      adjustTenantPlan: jest.fn(async () => ({ success: true })),
    }));

    jest.doMock('../../api/services/tenantAIService', () => ({
      getAIConfig: getAIConfigImpl,
      saveAIConfig: jest.fn(async () => ({ success: true })),
      saveAICredentials: jest.fn(async () => ({ success: true })),
      getDecryptedAPIKey: getDecryptedAPIKeyImpl,
    }));

    jest.doMock('../../api/services/systemStatusService', () => ({
      checkServicesStatus: jest.fn(async () => ({ overall: { status: 'healthy' }, services: {} })),
      checkApiServerStatus: jest.fn(async () => ({ status: 'healthy' })),
      checkRagServiceStatus: checkRagServiceStatusImpl,
      checkRedisStatus: jest.fn(async () => ({ status: 'healthy' })),
      checkWebSocketStatus: jest.fn(async () => ({ status: 'healthy' })),
    }));

    const { createServer } = require('../../api/server');
    return {
      server: createServer(),
      mocks: {
        getAIConfig: getAIConfigImpl,
        getDecryptedAPIKey: getDecryptedAPIKeyImpl,
        checkRagServiceStatus: checkRagServiceStatusImpl,
      },
    };
  }

  test('retorna 200 quando provider e RAG estão disponíveis', async () => {
    const { server, mocks } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/system/pipeline/validate-prereqs',
      body: { executionId: 'exec-test-1', useRag: true },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        ok: true,
        executionId: 'exec-test-1',
        tenantId: 'system',
        providerValidated: true,
        ragValidated: true,
        provider: 'openai',
      })
    );
    expect(mocks.getAIConfig).toHaveBeenCalledWith('system');
    expect(mocks.getDecryptedAPIKey).toHaveBeenCalledWith('system', 'openai');
    expect(mocks.checkRagServiceStatus).toHaveBeenCalled();
  });

  test('retorna 422 quando provider não está configurado', async () => {
    const { server } = startServerWithMocks({
      getAIConfig: jest.fn(async () => ({ primary: null, configured: false })),
      getDecryptedAPIKey: jest.fn(async () => null),
    });
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/system/pipeline/validate-prereqs',
      body: { executionId: 'exec-test-2', useRag: true },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(422);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'provider_not_configured',
        code: 'PROVIDER_NOT_CONFIGURED',
      })
    );
  });

  test('retorna 422 quando RAG está indisponível', async () => {
    const { server } = startServerWithMocks({
      checkRagServiceStatus: jest.fn(async () => ({
        status: 'unhealthy',
        error: 'Serviço RAG indisponível',
        details: { serviceUrl: 'http://rag:8000' },
      })),
    });
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/system/pipeline/validate-prereqs',
      body: { executionId: 'exec-test-3', useRag: true },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(422);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'rag_unavailable',
        code: 'RAG_UNAVAILABLE',
      })
    );
  });
});
