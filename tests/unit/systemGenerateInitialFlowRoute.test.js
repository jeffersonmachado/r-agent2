const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('POST /system/generate-initial-flow', () => {
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
    const generateInitialGraphImpl = overrides.generateInitialGraph || jest.fn(async () => ({
      reteJson: { id: 'flow-1', nodes: {}, connections: [] },
      categories: [{ category: 'Atendimento', questions: ['Como funciona?'] }],
      coverage: 0.65,
      persisted: false,
      excludedItemsCount: 0,
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

    jest.doMock('../../api/services/initialGraphService', () => ({
      generateInitialGraph: generateInitialGraphImpl,
    }));

    const { createServer } = require('../../api/server');
    return {
      server: createServer(),
      mocks: {
        generateInitialGraph: generateInitialGraphImpl,
      },
    };
  }

  test('retorna 200 com initialFlow e entities', async () => {
    const { server, mocks } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/system/generate-initial-flow',
      body: {
        tenantId: 'system',
        targetTenantId: 'tenant-target',
        executionId: 'exec-test-initial-1',
        dryRun: true,
      },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        initialFlow: expect.any(Object),
        entities: expect.objectContaining({
          categories: expect.any(Array),
          coverage: 0.65,
        }),
        persisted: false,
      })
    );
    expect(mocks.generateInitialGraph).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantIdForAI: 'system',
        tenantIdTarget: 'tenant-target',
        executionId: 'exec-test-initial-1',
      })
    );
  });
});
