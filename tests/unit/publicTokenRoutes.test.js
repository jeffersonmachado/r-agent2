describe('publicTokenRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      logAction: jest.fn(),
      checkRateLimit: jest.fn(async () => ({ allowed: true })),
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      url: '/x',
      tenantId: 'tenant-1',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      agent: { id: 'a-1', username: 'agent' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna false para rota nao tratada', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({}));
    const { handlePublicTokenRoutes } = require('../../api/serverHandlers/publicTokenRoutes');

    const deps = makeDeps();
    const handled = await handlePublicTokenRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
  });

  test('GET /public-tokens bloqueia includeToken sem permissao update', async () => {
    const listPublicTokens = jest.fn(async () => []);
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ listPublicTokens }));
    const { handlePublicTokenRoutes } = require('../../api/serverHandlers/publicTokenRoutes');

    const req = makeReq({ url: '/public-tokens?includeToken=true' });
    const res = {};
    const deps = makeDeps({
      requirePermission: jest
        .fn()
        .mockReturnValueOnce({ allowed: true })
        .mockReturnValueOnce({ allowed: false }),
    });

    const handled = await handlePublicTokenRoutes({ req, res, method: 'GET', pathname: '/public-tokens', deps });

    expect(handled).toBe(true);
    expect(listPublicTokens).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, {
      error: 'forbidden',
      message: 'Permissão insuficiente para incluir tokens em texto claro',
    });
  });

  test('GET /public-tokens normaliza filtros e retorna lista', async () => {
    const listPublicTokens = jest.fn(async () => [{ id: 'pt-1' }]);
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ listPublicTokens }));
    const { handlePublicTokenRoutes } = require('../../api/serverHandlers/publicTokenRoutes');

    const req = makeReq({ url: '/public-tokens?kind=kiosk&locationId=loc-1&active=true' });
    const res = {};
    const deps = makeDeps();

    const handled = await handlePublicTokenRoutes({ req, res, method: 'GET', pathname: '/public-tokens', deps });

    expect(handled).toBe(true);
    expect(listPublicTokens).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      kind: 'kiosk',
      locationId: 'loc-1',
      active: true,
      includeToken: false,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      items: [{ id: 'pt-1' }],
    });
  });

  test('POST /public-tokens valida kind', async () => {
    const createPublicToken = jest.fn(async () => ({ id: 'pt-1' }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ createPublicToken }));
    const { handlePublicTokenRoutes } = require('../../api/serverHandlers/publicTokenRoutes');

    const req = makeReq();
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ kind: 'invalid' })) });

    const handled = await handlePublicTokenRoutes({ req, res, method: 'POST', pathname: '/public-tokens', deps });

    expect(handled).toBe(true);
    expect(createPublicToken).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Campo "kind" inválido. Use: storefront|kiosk|panel|station');
  });

  test('POST /public-tokens cria token e audita', async () => {
    const createPublicToken = jest.fn(async () => ({ id: 'pt-2', token: 'abc' }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ createPublicToken }));
    const { handlePublicTokenRoutes } = require('../../api/serverHandlers/publicTokenRoutes');

    const req = makeReq({ headers: { 'user-agent': 'jest' } });
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        kind: 'storefront',
        locationId: 'loc-22',
        meta: { x: 1 },
        expiresInSec: 3600,
      })),
    });

    const handled = await handlePublicTokenRoutes({ req, res, method: 'POST', pathname: '/public-tokens', deps });

    expect(handled).toBe(true);
    expect(createPublicToken).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      kind: 'storefront',
      locationId: 'loc-22',
      meta: { x: 1 },
      expiresInSec: 3600,
    });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, {
      ok: true,
      token: { id: 'pt-2', token: 'abc' },
    });
  });

  test('POST /public-tokens/:id/revoke retorna 404 quando token nao existe', async () => {
    const revokePublicToken = jest.fn(async () => ({ ok: false }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ revokePublicToken }));
    const { handlePublicTokenRoutes } = require('../../api/serverHandlers/publicTokenRoutes');

    const req = makeReq({ url: '/public-tokens/pt-9/revoke?reason=test' });
    const res = {};
    const deps = makeDeps();

    const handled = await handlePublicTokenRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/public-tokens/pt-9/revoke',
      deps,
    });

    expect(handled).toBe(true);
    expect(revokePublicToken).toHaveBeenCalledWith({ tenantId: 'tenant-1', tokenId: 'pt-9', reason: 'test' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'not_found',
      message: 'Token não encontrado',
    });
  });

  test('POST /public-tokens/:id/rotate mapeia token_inactive para 409', async () => {
    const rotatePublicToken = jest.fn(async () => ({ ok: false, error: 'token_inactive' }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ rotatePublicToken }));
    const { handlePublicTokenRoutes } = require('../../api/serverHandlers/publicTokenRoutes');

    const req = makeReq({ url: '/public-tokens/pt-10/rotate?expiresInSec=1200' });
    const res = {};
    const deps = makeDeps();

    const handled = await handlePublicTokenRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/public-tokens/pt-10/rotate',
      deps,
    });

    expect(handled).toBe(true);
    expect(rotatePublicToken).toHaveBeenCalledWith({ tenantId: 'tenant-1', tokenId: 'pt-10', expiresInSec: 1200 });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 409, {
      error: 'conflict',
      message: 'Token já está inativo',
    });
  });

  test('GET /public-tokens/resolve retorna 429 quando rate limit bloqueia', async () => {
    const resolvePublicToken = jest.fn();
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    const { handlePublicTokenRoutes } = require('../../api/serverHandlers/publicTokenRoutes');

    const req = makeReq({
      url: '/public-tokens/resolve?token=abc',
      headers: { 'x-forwarded-for': '9.9.9.9' },
    });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ checkRateLimit: jest.fn(async () => ({ allowed: false, retryAfter: 30 })) });

    const handled = await handlePublicTokenRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/public-tokens/resolve',
      deps,
    });

    expect(handled).toBe(true);
    expect(resolvePublicToken).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 30);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 429, {
      error: 'rate_limit_exceeded',
      message: 'Limite de requisições excedido. Tente novamente em 30 segundos.',
      retryAfter: 30,
    });
  });

  test('GET /public-tokens/resolve retorna token resolvido', async () => {
    const resolvePublicToken = jest.fn(async () => ({
      ok: true,
      tokenId: 'pt-11',
      kind: 'panel',
      tenantId: 'tenant-1',
      locationId: 'loc-44',
      meta: { label: 'A' },
    }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    const { handlePublicTokenRoutes } = require('../../api/serverHandlers/publicTokenRoutes');

    const req = makeReq({ url: '/public-tokens/resolve?token=xyz' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps();

    const handled = await handlePublicTokenRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/public-tokens/resolve',
      deps,
    });

    expect(handled).toBe(true);
    expect(resolvePublicToken).toHaveBeenCalledWith({
      token: 'xyz',
      allowedKinds: ['storefront', 'kiosk', 'panel', 'station'],
    });
    expect(deps.logAction).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      token: {
        id: 'pt-11',
        kind: 'panel',
        tenantId: 'tenant-1',
        locationId: 'loc-44',
        meta: { label: 'A' },
      },
    });
  });
});
