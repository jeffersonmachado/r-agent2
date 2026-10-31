/**
 * Teste mínimo: POST /web-scraping/scrape-batch
 * - quando 100% falha: retorna 207 Multi-Status e errorSummary preenchido
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

describe('POST /web-scraping/scrape-batch', () => {
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
          if (address && typeof address === 'object') {
            resolve({ skip: false, port: address.port });
          } else {
            resolve({ skip: true });
          }
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

  // Este teste pode ser mais lento em ambientes de CI (boot do server + mocks).
  test('retorna 207 e errorSummary quando todas URLs falham', async () => {
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

    // Auth + RBAC
    jest.doMock('../../api/services/authService', () => ({
      validateToken: jest.fn(() => ({
        valid: true,
        agent: { id: 'a1', username: 'u1', role: 'owner', tenantId: 't1', is_superadmin: false },
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
    jest.doMock('../../api/services/auditService', () => ({
      logAction: jest.fn(),
      queryLogs: jest.fn(async () => ([])),
      getAuditStats: jest.fn(async () => ({})),
      registerGeneration: jest.fn(async () => ({})),
      generateAuditReport: jest.fn(async () => ({})),
    }));

    // Mock do scraping: 100% falha
    jest.doMock('../../api/services/webScrapingService', () => ({
      scrapeUrl: jest.fn(),
      scrapeUrls: jest.fn(async () => ([
        {
          url: 'https://studiooly.com.br/',
          success: false,
          status: 'failed',
          error: { name: 'ReferenceError', message: 'recording is not defined', stack: 'stack...' },
          durationMs: 12,
        },
      ])),
    }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }
    const port = listenResult.port;

    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          port,
          path: '/web-scraping/scrape-batch',
          headers: {
            Authorization: 'Bearer t1',
            'Content-Type': 'application/json',
          },
        },
        (r) => {
          let data = '';
          r.on('data', (c) => { data += c; });
          r.on('end', () => {
            let body = null;
            try { body = JSON.parse(data); } catch { body = data; }
            resolve({ status: r.statusCode, body });
          });
        }
      );
      req.on('error', reject);
      req.write(JSON.stringify({ executionId: 'exec-scrape-1', urls: ['https://studiooly.com.br/'] }));
      req.end();
    });

    // Com executionId obrigatório, 0 sucessos dispara gate terminal SCRAPING_EMPTY.
    expect(res.status).toBe(409);
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'SCRAPING_EMPTY',
        httpStatus: 409,
      }),
    }));

    await new Promise((resolve) => server.close(resolve));
  }, 45000);

  test('retorna 500 + envelope quando ocorre crash interno', async () => {
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

    // Auth + RBAC
    jest.doMock('../../api/services/authService', () => ({
      validateToken: jest.fn(() => ({
        valid: true,
        agent: { id: 'a1', username: 'u1', role: 'owner', tenantId: 't1', is_superadmin: false },
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
    jest.doMock('../../api/services/auditService', () => ({
      logAction: jest.fn(),
      queryLogs: jest.fn(async () => ([])),
      getAuditStats: jest.fn(async () => ({})),
      registerGeneration: jest.fn(async () => ({})),
      generateAuditReport: jest.fn(async () => ({})),
    }));

    // Mock do scraping: crash
    jest.doMock('../../api/services/webScrapingService', () => ({
      scrapeUrl: jest.fn(),
      scrapeUrls: jest.fn(async () => {
        throw new Error('boom');
      }),
    }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }
    const port = listenResult.port;

    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          port,
          path: '/web-scraping/scrape-batch',
          headers: {
            Authorization: 'Bearer t1',
            'Content-Type': 'application/json',
            'X-Request-Id': 'req-crash-1',
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
      req.write(JSON.stringify({ executionId: 'exec-crash-1', urls: ['https://studiooly.com.br/'] }));
      req.end();
    });

    expect(res.status).toBe(500);
    // O endpoint normaliza falhas do scraping com um code específico.
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'SCRAPE_FAILED',
        httpStatus: 500,
      }),
    }));
    expect(res.headers['x-request-id']).toBe('req-crash-1');

    await new Promise((resolve) => server.close(resolve));
  });
});
