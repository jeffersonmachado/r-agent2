const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('POST /rag/ephemeral/context', () => {
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
    const upsertEphemeralContextImpl = overrides.upsertEphemeralContext || jest.fn(async () => ({
      ok: true,
      stored: 2,
      ttlSeconds: 1800,
      key: 'ctx:system:exec-test-1',
      used: 'memory',
      stats: { received: 2 },
    }));

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
      requirePermission: jest.fn(() => ({ allowed: true })),
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

    jest.doMock('../../api/services/ephemeralRagContextService', () => ({
      upsertEphemeralContext: upsertEphemeralContextImpl,
      getEphemeralContext: jest.fn(async () => ({ ok: true, found: false, chunks: [], used: 'memory' })),
    }));

    const { createServer } = require('../../api/server');
    return {
      server: createServer(),
      mocks: {
        upsertEphemeralContext: upsertEphemeralContextImpl,
      },
    };
  }

  test('retorna 200 e persiste contexto efêmero', async () => {
    const { server, mocks } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/rag/ephemeral/context',
      body: {
        tenantId: 'system',
        executionId: 'exec-test-1',
        chunks: [
          { sourceType: 'uploaded_file', sourceId: 'f1', text: 'Texto suficientemente grande para passar na validação 1' },
          { sourceType: 'web_scraping', sourceId: 'u1', text: 'Texto suficientemente grande para passar na validação 2' },
        ],
        replace: true,
      },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        ok: true,
        tenantId: 'system',
        executionId: 'exec-test-1',
        stored: 2,
      })
    );
    expect(mocks.upsertEphemeralContext).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'system',
        executionId: 'exec-test-1',
        replace: true,
      })
    );
  });

  test('retorna 400 quando executionId é inválido', async () => {
    const { server } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/rag/ephemeral/context',
      body: {
        tenantId: 'system',
        executionId: 'bad-id',
        chunks: [],
      },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(400);
    expect(String(response.body?.message || response.body?.error || '')).toMatch(/executionId inválido/i);
  });
});
