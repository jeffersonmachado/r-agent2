/**
 * Hardening: tenant obrigatório.
 *
 * Teste mínimo: rota protegida deve falhar (401/403) quando o agente autenticado
 * não possui tenantId.
 */

const http = require('http');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('tenant obrigatório', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('GET /bulk-campaigns com agente sem tenantId retorna 401', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    // Auth: token válido, mas tenantId ausente no agente
    jest.doMock('../../api/services/authService', () => ({
      validateToken: jest.fn(() => ({
        valid: true,
        agent: { id: 'a1', username: 'u1', role: 'owner', tenantId: null, is_superadmin: false },
        session: { token: 't1' },
      })),
    }));
    jest.doMock('../../api/services/rbacService', () => ({ hasPermission: jest.fn(() => true) }));
    jest.doMock('../../api/services/superAdminService', () => ({ isSuperAdmin: jest.fn(() => false) }));

    // Evita boot de workers/serviços não relevantes
    jest.doMock('../../api/services/outboundWorker', () => ({ start: jest.fn(), stop: jest.fn() }));
    jest.doMock('../../api/services/channelHealthService', () => ({ startChannelHealthMonitor: jest.fn() }));
    jest.doMock('../../api/services/handoverService', () => ({ startAutoReturnToBot: jest.fn(), takeOver: jest.fn(), returnToBot: jest.fn() }));
    jest.doMock('../../api/services/assignmentService', () => ({ startAssignmentWorker: jest.fn(), autoAssign: jest.fn() }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({ initialize: jest.fn(async () => {}) }));
    jest.doMock('../../api/services/queueService', () => ({ startAutoCleanup: jest.fn() }));
    jest.doMock('../../api/services/bulkMessagingService', () => ({ listCampaigns: jest.fn(() => []) }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'GET',
          port,
          path: '/bulk-campaigns',
          headers: { Authorization: 'Bearer t1' },
        },
        (r) => {
          let data = '';
          r.on('data', (c) => { data += c; });
          r.on('end', () => resolve({ status: r.statusCode, body: data }));
        }
      );
      req.on('error', reject);
      req.end();
    });

    expect([401, 403]).toContain(res.status);

    await new Promise((resolve) => server.close(resolve));
  });
});

