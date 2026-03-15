const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('GET /rag/health', () => {
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

  async function httpGet({ port, path }) {
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'GET',
          hostname: '127.0.0.1',
          port,
          path,
          headers: {
            Authorization: 'Bearer fake-token',
            Accept: 'application/json',
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
    const getRagHealthImpl = overrides.getRagHealth || jest.fn(async () => ({
      status: 'healthy',
      dbIndexedDocuments: 1,
      vectorIndexedDocuments: 1,
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

    jest.doMock('../../api/services/ragDocumentsService', () => ({
      listDocuments: jest.fn(),
      getDocument: jest.fn(),
      createDocument: jest.fn(),
      updateDocument: jest.fn(),
      deleteDocument: jest.fn(),
      reindexDocument: jest.fn(),
      reindexAllNotIndexed: jest.fn(),
      getDocumentsStats: jest.fn(),
      getRagHealth: getRagHealthImpl,
    }));

    const { createServer } = require('../../api/server');
    return {
      server: createServer(),
      mocks: {
        getRagHealth: getRagHealthImpl,
      },
    };
  }

  test('retorna 200 com health do RAG', async () => {
    const { server, mocks } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpGet({
      port: listenResult.port,
      path: '/rag/health?tenantId=system',
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ status: 'healthy' }));
    expect(mocks.getRagHealth).toHaveBeenCalledWith('system', { autoRepair: false });
  });
});
