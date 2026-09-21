'use strict';

/**
 * PUT /tenants/:tenantId/ai-credentials
 *
 * Achado real testando a tela de config com ?tenant=<id> na URL (super-admin configurando IA
 * para um tenant específico, não o "current"): o frontend já monta essa rota
 * (frontend/src/api/config.js::saveTenantAiCredentials), mas o backend nunca a implementou — só
 * existia PUT /tenants/current/ai-credentials. Resultado real observado: 404 not_found sempre
 * que um super-admin tentava salvar a credencial de outro tenant.
 */

const express = require('express');
const http = require('http');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('PUT /tenants/:tenantId/ai-credentials', () => {
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

  function startServerWithMocks(overrides = {}) {
    const defaultAgent = overrides.defaultAgent || { id: 'a1', username: 'systemadmin', tenantId: 'system', role: 'owner' };
    const requireAuthImpl = overrides.requireAuth || jest.fn((req) => {
      req.agent = defaultAgent;
      req.tenantId = defaultAgent.tenantId;
      return { valid: true, agent: defaultAgent };
    });
    const isSuperAdminImpl = overrides.isSuperAdminFn || jest.fn(() => !!overrides.isSuperAdmin);
    const saveTenantAiCredentialsRepoImpl = overrides.saveTenantAiCredentials || jest.fn(async () => {});

    jest.doMock('../../api/middleware/auth', () => ({
      requireAuth: requireAuthImpl,
      requirePermission: jest.fn(() => true),
    }));

    jest.doMock('../../api/services/superAdminService', () => ({
      isSuperAdmin: isSuperAdminImpl,
      listAllTenants: jest.fn(async () => ({ success: true, tenants: [] })),
      getTenantMetrics: jest.fn(async () => ({ success: true })),
      impersonateUser: jest.fn(async () => ({ success: true })),
      blockTenant: jest.fn(async () => ({ success: true })),
      unblockTenant: jest.fn(async () => ({ success: true })),
      adjustTenantPlan: jest.fn(async () => ({ success: true })),
    }));

    jest.doMock('../../api/services/tenantAIService', () => ({
      getAIConfig: jest.fn(async () => ({ primary: 'openai' })),
      saveAIConfig: jest.fn(async () => ({ success: true })),
      saveAICredentials: jest.fn(async () => ({ success: true })),
      getDecryptedAPIKey: jest.fn(async () => ''),
      recordCredentialTestResult: jest.fn(async () => true),
    }));

    const { createTenantRepository } = require('../../api/modules/tenant/repository');
    const { createTenantService } = require('../../api/modules/tenant/service');
    const { createTenantController } = require('../../api/modules/tenant/controller');
    const { createTenantRoutes } = require('../../api/modules/tenant/routes');
    const { requirePermission } = require('../../api/middleware/auth');
    const { isSuperAdmin } = require('../../api/services/superAdminService');
    const { emitEvent } = require('../../api/services/websocketService');
    const tenantAIService = require('../../api/services/tenantAIService');
    const tenantValidator = require('../../api/modules/tenant/validator');

    const repository = createTenantRepository({
      getTenant: jest.fn(async () => null),
      listTenants: jest.fn(async () => []),
      createTenant: jest.fn(async () => ({ success: true, tenant: {} })),
      updateTenant: jest.fn(async () => ({ success: true, tenant: {} })),
      deleteTenant: jest.fn(async () => ({ success: true })),
      getTenantUsage: jest.fn(async () => ({})),
      getPlanLimits: jest.fn(() => ({})),
      getTenantContext: jest.fn(() => null),
      updateTenantContext: jest.fn(async () => ({ success: true })),
      suspendTenant: jest.fn(async () => ({ success: true, tenant: {} })),
      reactivateTenant: jest.fn(async () => ({ success: true, tenant: {} })),
      changePlan: jest.fn(async () => ({ success: true, tenant: {} })),
      tenantAIService,
    });
    // Sobrescreve especificamente o método sob teste (repository delega para tenantAIService,
    // mas queremos observar a chamada diretamente).
    repository.saveTenantAiCredentials = saveTenantAiCredentialsRepoImpl;

    const service = createTenantService({
      repository,
      validator: tenantValidator,
      isSuperAdmin,
      logger: require('../../api/utils/logger'),
      logAction: jest.fn(),
      generateAiResponse: jest.fn(),
      registerGeneration: jest.fn(),
      tenantAIService,
    });

    const controller = createTenantController({
      requireAuth: requireAuthImpl,
      requirePermission,
      service,
      emitEvent,
    });

    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use('/tenants', createTenantRoutes({ controller }));
    app.use((err, req, res, next) => {
      if (err instanceof SyntaxError || err?.type === 'entity.parse.failed') {
        res.status(400).json({ error: 'bad_request', message: 'JSON inválido no corpo da requisição' });
        return;
      }
      next(err);
    });

    return {
      server: http.createServer(app),
      mocks: { requireAuth: requireAuthImpl, isSuperAdmin: isSuperAdminImpl, saveTenantAiCredentials: saveTenantAiCredentialsRepoImpl },
    };
  }

  async function httpPutJson({ port, path, token, body }) {
    const payload = JSON.stringify(body || {});
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'PUT',
          hostname: '127.0.0.1',
          port,
          path,
          headers: {
            Authorization: token ? `Bearer ${token}` : undefined,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
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

  test('super-admin salva credenciais de um tenant específico (não mais 404)', async () => {
    const { server, mocks } = startServerWithMocks({ isSuperAdmin: true });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) return;

    const response = await httpPutJson({
      port: listenResult.port,
      path: '/tenants/other-tenant/ai-credentials',
      token: 'fake-token',
      body: { provider: 'deepseek', apiKey: 'sk-test-deepseek' },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ success: true }));
    expect(mocks.saveTenantAiCredentials).toHaveBeenCalledWith('other-tenant', 'deepseek', 'sk-test-deepseek');
  });

  test('retorna 403 quando quem chama não é super-admin', async () => {
    const { server, mocks } = startServerWithMocks({
      isSuperAdmin: false,
      defaultAgent: { id: 'a2', username: 'admin', tenantId: 'tenant-demo', role: 'admin' },
    });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) return;

    const response = await httpPutJson({
      port: listenResult.port,
      path: '/tenants/other-tenant/ai-credentials',
      token: 'fake-token',
      body: { provider: 'deepseek', apiKey: 'sk-test' },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(403);
    expect(mocks.saveTenantAiCredentials).not.toHaveBeenCalled();
  });

  test('retorna 400 quando provider é inválido', async () => {
    const { server, mocks } = startServerWithMocks({ isSuperAdmin: true });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) return;

    const response = await httpPutJson({
      port: listenResult.port,
      path: '/tenants/other-tenant/ai-credentials',
      token: 'fake-token',
      body: { provider: 'not-a-real-provider', apiKey: 'sk-test' },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(400);
    expect(mocks.saveTenantAiCredentials).not.toHaveBeenCalled();
  });

  test('retorna 401 quando autenticação falha', async () => {
    const requireAuth = jest.fn(() => ({ valid: false, error: 'Token inválido' }));
    const { server, mocks } = startServerWithMocks({ requireAuth, isSuperAdmin: true });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) return;

    const response = await httpPutJson({
      port: listenResult.port,
      path: '/tenants/other-tenant/ai-credentials',
      token: 'invalid-token',
      body: { provider: 'deepseek', apiKey: 'sk-test' },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(401);
    expect(mocks.saveTenantAiCredentials).not.toHaveBeenCalled();
  });

  test('não conflita com o alias /tenants/current/ai-credentials (rota literal continua vencendo)', async () => {
    const { server, mocks } = startServerWithMocks({
      isSuperAdmin: true,
      defaultAgent: { id: 'a3', username: 'admin', tenantId: 'tenant-demo', role: 'admin' },
    });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) return;

    const response = await httpPutJson({
      port: listenResult.port,
      path: '/tenants/current/ai-credentials',
      token: 'fake-token',
      body: { provider: 'openai', apiKey: 'sk-test' },
    });

    await new Promise((resolve) => server.close(resolve));

    // saveCurrentTenantAiCredentials (não a rota nova de super-admin) atende este alias — a
    // string literal "current" NUNCA deve cair na rota /:tenantId/ai-credentials nova.
    expect(response.status).toBe(200);
    expect(mocks.saveTenantAiCredentials).toHaveBeenCalledWith('tenant-demo', 'openai', 'sk-test');
  });
});
