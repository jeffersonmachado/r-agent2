const http = require('http');
const { TIMEOUT_BOOT_APP_MS } = require('../helpers/jestTimeouts');

// Este arquivo boota o SERVIDOR REAL (`api/server.js`) uma vez por teste: cada
// teste custa ~7-8 s (medido 6.7-8.0 s em isolamento) só de criar o servidor e
// exercitar a rota. O `testTimeout: 10000` do `jest.config.cjs` NÃO governa
// aqui — `jest.setTimeout` no arquivo prevalece (verificado: com
// --testTimeout=1000 os testes continuam passando, logo vale este valor).
// 30 s está dentro de [min,max] de INTEGRATION_TEST em `config/timeout-policy.json`.
// NÃO reduzir: sob carga concorrente o boot do servidor estoura budgets
// apertados e produz falso vermelho (flake observado em 2026-09-26 com o
// `test:unit` paralelo — a suíte completa passa 877/877 quando não há disputa).
jest.setTimeout(TIMEOUT_BOOT_APP_MS);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('POST /system/generate-faq', () => {
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
    const generateFaqImpl = overrides.generateFaq || jest.fn(async () => ({
      faq: [{ category: 'Atendimento', questions: ['Qual o horario de atendimento?'] }],
      flatQuestions: ['Qual o horario de atendimento?'],
      coverage: 0.7,
      exclusions: [],
      meta: { usedContext: 'inline' },
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

    jest.doMock('../../api/services/faqGeneratorService', () => ({
      generateFaq: generateFaqImpl,
    }));

    const { createServer } = require('../../api/server');
    return {
      server: createServer(),
      mocks: {
        generateFaq: generateFaqImpl,
      },
    };
  }

  test('retorna 200 com FAQ agrupado', async () => {
    const { server, mocks } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/system/generate-faq',
      body: {
        tenantId: 'system',
        name: 'Tenant Teste',
        executionId: 'exec-test-faq-1',
        pipelineStage: 'questionsGenerated',
      },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        faq: expect.any(Array),
        flatQuestions: expect.any(Array),
        coverage: 0.7,
      })
    );
    expect(mocks.generateFaq).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'system',
        executionId: 'exec-test-faq-1',
      })
    );
  });

  test('repassa questionMode=inferential ao service; default extractive', async () => {
    const { server, mocks } = startServerWithMocks();
    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const inferential = await httpPostJson({
      port: listenResult.port,
      path: '/system/generate-faq',
      body: { tenantId: 'system', name: 'Tenant Teste', questionMode: 'inferential' },
    });
    expect(inferential.status).toBe(200);
    expect(mocks.generateFaq).toHaveBeenLastCalledWith(
      expect.objectContaining({ questionMode: 'inferential' })
    );

    const padrao = await httpPostJson({
      port: listenResult.port,
      path: '/system/generate-faq',
      body: { tenantId: 'system', name: 'Tenant Teste' },
    });
    expect(padrao.status).toBe(200);
    expect(mocks.generateFaq).toHaveBeenLastCalledWith(
      expect.objectContaining({ questionMode: 'extractive' })
    );

    await new Promise((resolve) => server.close(resolve));
  });
});
