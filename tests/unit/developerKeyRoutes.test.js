describe('developerKeyRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn((req, resource, action) => ({ allowed: true, resource, action })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      logAction: jest.fn(),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna false para rota nao tratada', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({}));
    const { handleDeveloperKeyRoutes } = require('../../api/modules/developer-key/handleDeveloperKeyRoutes');

    const deps = makeDeps();
    const handled = await handleDeveloperKeyRoutes({
      req: {},
      res: {},
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
  });

  test('GET /developer/keys retorna 401 sem autenticacao', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ listPublicTokens: jest.fn() }));
    const { handleDeveloperKeyRoutes } = require('../../api/modules/developer-key/handleDeveloperKeyRoutes');

    const req = { url: '/developer/keys' };
    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'invalid_token' })) });

    const handled = await handleDeveloperKeyRoutes({ req, res, method: 'GET', pathname: '/developer/keys', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'invalid_token',
    });
  });

  test('GET /developer/keys exige permissao extra quando includeToken=true', async () => {
    const listPublicTokens = jest.fn(async () => []);
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ listPublicTokens }));
    const { handleDeveloperKeyRoutes } = require('../../api/modules/developer-key/handleDeveloperKeyRoutes');

    const req = { url: '/developer/keys?includeToken=true', tenantId: 't1' };
    const res = {};
    const deps = makeDeps({
      requirePermission: jest.fn((_, __, action) => {
        if (action === 'update') return { allowed: false };
        return { allowed: true };
      }),
    });

    const handled = await handleDeveloperKeyRoutes({ req, res, method: 'GET', pathname: '/developer/keys', deps });

    expect(handled).toBe(true);
    expect(listPublicTokens).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, {
      error: 'forbidden',
      message: 'Permissão insuficiente para incluir tokens em texto claro',
    });
  });

  test('GET /developer/keys normaliza active/includeToken e lista itens', async () => {
    const listPublicTokens = jest.fn(async () => [{ id: 'k1' }]);
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ listPublicTokens }));
    const { handleDeveloperKeyRoutes } = require('../../api/modules/developer-key/handleDeveloperKeyRoutes');

    const req = { url: '/developer/keys?includeToken=false&active=false', tenantId: 't1' };
    const res = {};
    const deps = makeDeps();

    const handled = await handleDeveloperKeyRoutes({ req, res, method: 'GET', pathname: '/developer/keys', deps });

    expect(handled).toBe(true);
    expect(listPublicTokens).toHaveBeenCalledWith({
      tenantId: 't1',
      kind: 'developer',
      active: false,
      includeToken: false,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { ok: true, items: [{ id: 'k1' }] });
  });

  test('POST /developer/keys valida content-type', async () => {
    const createPublicToken = jest.fn(async () => ({ id: 'key-1' }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ createPublicToken }));
    const { handleDeveloperKeyRoutes } = require('../../api/modules/developer-key/handleDeveloperKeyRoutes');

    const req = { tenantId: 't1' };
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handleDeveloperKeyRoutes({ req, res, method: 'POST', pathname: '/developer/keys', deps });

    expect(handled).toBe(true);
    expect(createPublicToken).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /developer/keys cria token e registra auditoria', async () => {
    const createPublicToken = jest.fn(async () => ({ id: 'key-1', token: 'abc' }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ createPublicToken }));
    const { handleDeveloperKeyRoutes } = require('../../api/modules/developer-key/handleDeveloperKeyRoutes');

    const req = {
      tenantId: 't1',
      agent: { id: 'a1', username: 'agent-1' },
      headers: { 'user-agent': 'jest-agent', 'x-forwarded-for': '10.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        name: ' Chave Integracao ',
        description: ' Integracao externa ',
        expiresInSec: 3600,
      })),
    });

    const handled = await handleDeveloperKeyRoutes({ req, res, method: 'POST', pathname: '/developer/keys', deps });

    expect(handled).toBe(true);
    expect(createPublicToken).toHaveBeenCalledWith({
      tenantId: 't1',
      kind: 'developer',
      meta: {
        name: 'Chave Integracao',
        description: 'Integracao externa',
      },
      expiresInSec: 3600,
    });
    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'developer_key_create',
      tenantId: 't1',
      resource: 'developer_key',
      resourceId: 'key-1',
    }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, {
      ok: true,
      key: { id: 'key-1', token: 'abc' },
    });
  });

  test('GET /developer/usage retorna 503 quando stats indisponivel', async () => {
    const getPublicTokenStats = jest.fn(async () => ({ ok: false, error: 'stats_unavailable' }));
    const listPublicTokens = jest.fn(async () => []);
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ getPublicTokenStats, listPublicTokens }));
    const { handleDeveloperKeyRoutes } = require('../../api/modules/developer-key/handleDeveloperKeyRoutes');

    const req = { tenantId: 't1' };
    const res = {};
    const deps = makeDeps();

    const handled = await handleDeveloperKeyRoutes({ req, res, method: 'GET', pathname: '/developer/usage', deps });

    expect(handled).toBe(true);
    expect(listPublicTokens).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 503, {
      error: 'service_unavailable',
      message: 'stats_unavailable',
    });
  });

  test('GET /developer/usage agrega totais e rotas', async () => {
    const getPublicTokenStats = jest.fn(async () => ({
      ok: true,
      items: [
        { kind: 'developer', total: 3, active: 2, inactive: 1, revoked: 0, expired: 0 },
        { kind: 'other', total: 9, active: 9, inactive: 0, revoked: 0, expired: 0 },
      ],
    }));

    const listPublicTokens = jest.fn(async () => ([
      {
        id: 'k1',
        meta: {
          usageByRoute: {
            '/public/foo': { count: 2, lastUsedAt: '2026-02-01T10:00:00.000Z', lastStatusCode: 200 },
            '/public/bar': { count: 1, lastUsedAt: '2026-02-01T09:00:00.000Z', lastStatusCode: 500 },
          },
        },
      },
      {
        id: 'k2',
        meta: {
          usageByRoute: {
            '/public/foo': { count: 3, lastUsedAt: '2026-02-01T11:00:00.000Z', lastStatusCode: 201 },
          },
        },
      },
    ]));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ getPublicTokenStats, listPublicTokens }));
    const { handleDeveloperKeyRoutes } = require('../../api/modules/developer-key/handleDeveloperKeyRoutes');

    const req = { tenantId: 't1' };
    const res = {};
    const deps = makeDeps();

    const handled = await handleDeveloperKeyRoutes({ req, res, method: 'GET', pathname: '/developer/usage', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      tenantId: 't1',
      totals: { total: 3, active: 2, inactive: 1, revoked: 0, expired: 0 },
      items: [{ kind: 'developer', total: 3, active: 2, inactive: 1, revoked: 0, expired: 0 }],
      routes: [
        {
          route: '/public/foo',
          count: 5,
          lastUsedAt: '2026-02-01T11:00:00.000Z',
          lastStatusCode: 201,
          keys: 2,
        },
        {
          route: '/public/bar',
          count: 1,
          lastUsedAt: '2026-02-01T09:00:00.000Z',
          lastStatusCode: 500,
          keys: 1,
        },
      ],
    });
  });
});
