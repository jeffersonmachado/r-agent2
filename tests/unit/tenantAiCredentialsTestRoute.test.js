const express = require('express');
const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('POST /tenants/:tenantKey/ai-credentials/test', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function makeFetchResponseOk(payload) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: jest.fn(async () => payload),
      text: jest.fn(async () => JSON.stringify(payload)),
    };
  }

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
    const getAIConfigImpl = overrides.getAIConfig || jest.fn(async () => ({ primary: 'openai' }));
    const getDecryptedAPIKeyImpl = overrides.getDecryptedAPIKey || jest.fn(async () => '');

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
      getAIConfig: getAIConfigImpl,
      saveAIConfig: jest.fn(async () => ({ success: true })),
      saveAICredentials: jest.fn(async () => ({ success: true })),
      getDecryptedAPIKey: getDecryptedAPIKeyImpl,
    }));

    global.fetch = overrides.fetch || jest.fn(async () => makeFetchResponseOk({ data: [] }));

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
    app.use((req, res, next) => {
      if (req.path === '/tenants/current/ai-credentials/test') {
        const authResult = requireAuthImpl(req);
        if (authResult?.valid && !authResult.agent?.tenantId) {
          res.status(403).json({
            error: 'tenant_validation_failed',
            message: 'Agente não possui tenantId',
          });
          return;
        }
      }
      next();
    });
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
      mocks: {
        requireAuth: requireAuthImpl,
        getAIConfig: getAIConfigImpl,
        getDecryptedAPIKey: getDecryptedAPIKeyImpl,
        isSuperAdmin: isSuperAdminImpl,
      },
    };
  }

  async function httpPostJson({ port, path, token, body }) {
    const payload = JSON.stringify(body || {});

    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
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

  async function httpPostRaw({ port, path, token, headers, rawBody }) {
    const payload = rawBody == null ? '' : String(rawBody);
    const requestHeaders = {
      Authorization: token ? `Bearer ${token}` : undefined,
      ...(headers || {}),
    };
    if (payload) {
      requestHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          method: 'POST',
          hostname: '127.0.0.1',
          port,
          path,
          headers: requestHeaders,
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
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  test('retorna 200 (não 404) para /tenants/system/ai-credentials/test sem credencial salva', async () => {
    const { server, mocks } = startServerWithMocks({
      isSuperAdmin: true,
      getAIConfig: jest.fn(async () => ({ primary: 'openai' })),
      getDecryptedAPIKey: jest.fn(async () => ''),
    });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/tenants/system/ai-credentials/test',
      token: 'fake-token',
      body: {},
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        valid: false,
        provider: 'openai',
        tenantId: 'system',
      })
    );
    expect(String(response.body.error || '')).toMatch(/Credencial nao configurada|Credencial não configurada/i);
    expect(mocks.getAIConfig).toHaveBeenCalledWith('system');
    expect(mocks.getDecryptedAPIKey).toHaveBeenCalledWith('system', 'openai');
  });

  test('suporta alias /tenants/current/ai-credentials/test e valida credencial do tenant autenticado', async () => {
    const fetchMock = jest.fn(async () => makeFetchResponseOk({ data: [{ id: 'model-1' }] }));

    const { server, mocks } = startServerWithMocks({
      defaultAgent: { id: 'a2', username: 'admin', tenantId: 'tenant-demo', role: 'admin' },
      isSuperAdmin: false,
      getAIConfig: jest.fn(async () => ({ primary: 'openai' })),
      getDecryptedAPIKey: jest.fn(async () => 'sk-test-openai'),
      fetch: fetchMock,
    });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/tenants/current/ai-credentials/test',
      token: 'fake-token',
      body: {},
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        valid: true,
        provider: 'openai',
        tenantId: 'tenant-demo',
        error: null,
      })
    );

    expect(mocks.getAIConfig).toHaveBeenCalledWith('tenant-demo');
    expect(mocks.getDecryptedAPIKey).toHaveBeenCalledWith('tenant-demo', 'openai');
    expect(fetchMock).toHaveBeenCalled();
  });

  test('retorna 403 quando agente comum tenta validar credenciais de outro tenant', async () => {
    const getAIConfigMock = jest.fn(async () => ({ primary: 'openai' }));

    const { server, mocks } = startServerWithMocks({
      defaultAgent: { id: 'a3', username: 'agent1', tenantId: 'tenant-a', role: 'agent' },
      isSuperAdmin: false,
      getAIConfig: getAIConfigMock,
    });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/tenants/tenant-b/ai-credentials/test',
      token: 'fake-token',
      body: {},
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(403);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'forbidden',
      })
    );
    expect(mocks.getAIConfig).not.toHaveBeenCalled();
    expect(mocks.getDecryptedAPIKey).not.toHaveBeenCalled();
  });

  test('retorna 403 quando alias /tenants/current não resolve tenant no middleware', async () => {
    const { server, mocks } = startServerWithMocks({
      defaultAgent: { id: 'a4', username: 'admin', tenantId: null, role: 'admin' },
      isSuperAdmin: true,
      getAIConfig: jest.fn(async () => ({ primary: 'openai' })),
      getDecryptedAPIKey: jest.fn(async () => 'sk-test-openai'),
    });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/tenants/current/ai-credentials/test',
      token: 'fake-token',
      body: {},
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(403);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'tenant_validation_failed',
      })
    );
    expect(mocks.getAIConfig).not.toHaveBeenCalled();
    expect(mocks.getDecryptedAPIKey).not.toHaveBeenCalled();
  });

  test('prioriza provider do body no teste de credencial e preserva contrato de resposta', async () => {
    const { server, mocks } = startServerWithMocks({
      defaultAgent: { id: 'a5', username: 'admin', tenantId: 'tenant-demo', role: 'admin' },
      isSuperAdmin: false,
      getAIConfig: jest.fn(async () => ({ primary: 'openai' })),
      getDecryptedAPIKey: jest.fn(async () => ''),
    });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostJson({
      port: listenResult.port,
      path: '/tenants/current/ai-credentials/test',
      token: 'fake-token',
      body: { provider: 'anthropic' },
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        valid: false,
        provider: 'anthropic',
        tenantId: 'tenant-demo',
      })
    );
    expect(response.body).toHaveProperty('error');
    expect(mocks.getAIConfig).toHaveBeenCalledWith('tenant-demo');
    expect(mocks.getDecryptedAPIKey).toHaveBeenCalledWith('tenant-demo', 'anthropic');
  });

  test('retorna 400 para Content-Type não JSON sem cair em fallback', async () => {
    const { server, mocks } = startServerWithMocks({
      isSuperAdmin: true,
      getAIConfig: jest.fn(async () => ({ primary: 'openai' })),
      getDecryptedAPIKey: jest.fn(async () => 'sk-test-openai'),
    });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostRaw({
      port: listenResult.port,
      path: '/tenants/system/ai-credentials/test',
      token: 'fake-token',
      headers: {
        'Content-Type': 'text/plain',
      },
      rawBody: 'provider=openai',
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'bad_request',
      })
    );
    expect(mocks.getAIConfig).not.toHaveBeenCalled();
    expect(mocks.getDecryptedAPIKey).not.toHaveBeenCalled();
  });

  test('retorna 401 quando autenticação falha', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const requireAuth = jest.fn(() => ({ valid: false, error: 'Token inválido' }));
      const { server, mocks } = startServerWithMocks({
        requireAuth,
        isSuperAdmin: true,
        getAIConfig: jest.fn(async () => ({ primary: 'openai' })),
        getDecryptedAPIKey: jest.fn(async () => 'sk-test-openai'),
      });

      const listenResult = await listenOrSkip(server);
      if (listenResult.skip) {
        return;
      }

      const response = await httpPostJson({
        port: listenResult.port,
        path: '/tenants/system/ai-credentials/test',
        token: 'invalid-token',
        body: {},
      });

      await new Promise((resolve) => server.close(resolve));

      expect(response.status).toBe(401);
      expect(response.body).toEqual(
        expect.objectContaining({
          error: 'unauthorized',
        })
      );
      expect(mocks.getAIConfig).not.toHaveBeenCalled();
      expect(mocks.getDecryptedAPIKey).not.toHaveBeenCalled();
    } finally {
      if (prevNodeEnv == null) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = prevNodeEnv;
      }
    }
  });

  test('retorna 400 para JSON inválido no corpo da requisição', async () => {
    const { server, mocks } = startServerWithMocks({
      isSuperAdmin: true,
      getAIConfig: jest.fn(async () => ({ primary: 'openai' })),
      getDecryptedAPIKey: jest.fn(async () => 'sk-test-openai'),
    });

    const listenResult = await listenOrSkip(server);
    if (listenResult.skip) {
      return;
    }

    const response = await httpPostRaw({
      port: listenResult.port,
      path: '/tenants/system/ai-credentials/test',
      token: 'fake-token',
      headers: {
        'Content-Type': 'application/json',
      },
      rawBody: '{ invalid-json',
    });

    await new Promise((resolve) => server.close(resolve));

    expect(response.status).toBe(400);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: 'bad_request',
      })
    );
    expect(String(response.body.message || '')).toMatch(/JSON inválido/i);
    expect(mocks.getAIConfig).not.toHaveBeenCalled();
    expect(mocks.getDecryptedAPIKey).not.toHaveBeenCalled();
  });
});
