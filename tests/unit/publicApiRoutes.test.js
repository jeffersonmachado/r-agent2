describe('publicApiRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({ hello: 'world' })),
      logger: { error: jest.fn() },
      checkRateLimit: jest.fn(async () => ({ allowed: true, retryAfter: 0 })),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna false para rota nao tratada', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({}));
    const { handlePublicApiRoutes } = require('../../api/modules/public-api/handlePublicApiRoutes');

    const deps = makeDeps();
    const handled = await handlePublicApiRoutes({
      req: { headers: {} },
      res: {},
      method: 'GET',
      pathname: '/not-public',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
  });

  test('POST /public/* valida content-type', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({}));
    const { handlePublicApiRoutes } = require('../../api/modules/public-api/handlePublicApiRoutes');

    const req = { headers: {} };
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handlePublicApiRoutes({ req, res, method: 'POST', pathname: '/public/ping', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /public/* retorna 401 sem API key', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({
      resolvePublicToken: jest.fn(),
      recordPublicTokenUsage: jest.fn(),
    }));
    const { handlePublicApiRoutes } = require('../../api/modules/public-api/handlePublicApiRoutes');

    const req = { headers: {} };
    const res = { setHeader: jest.fn() };
    const deps = makeDeps();

    const handled = await handlePublicApiRoutes({ req, res, method: 'POST', pathname: '/public/ping', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'API key obrigatória',
    });
  });

  test('POST /public/* retorna 401 para API key invalida', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: false }));
    const recordPublicTokenUsage = jest.fn(async () => {});
    jest.doMock('../../api/services/publicAccessTokenService', () => ({
      resolvePublicToken,
      recordPublicTokenUsage,
    }));
    const { handlePublicApiRoutes } = require('../../api/modules/public-api/handlePublicApiRoutes');

    const req = { headers: { authorization: 'Bearer bad-key' } };
    const res = { setHeader: jest.fn() };
    const deps = makeDeps();

    const handled = await handlePublicApiRoutes({ req, res, method: 'POST', pathname: '/public/ping', deps });

    expect(handled).toBe(true);
    expect(resolvePublicToken).toHaveBeenCalledWith({ token: 'bad-key', allowedKinds: ['developer'] });
    expect(recordPublicTokenUsage).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'API key inválida',
    });
  });

  test('POST /public/* retorna 429 quando rate limit bloqueia', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'tok-1', tenantId: 't-1' }));
    const recordPublicTokenUsage = jest.fn(async () => {});
    jest.doMock('../../api/services/publicAccessTokenService', () => ({
      resolvePublicToken,
      recordPublicTokenUsage,
    }));
    const { handlePublicApiRoutes } = require('../../api/modules/public-api/handlePublicApiRoutes');

    const req = { headers: { 'x-api-key': 'abc' } };
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      checkRateLimit: jest.fn(async () => ({ allowed: false, retryAfter: 45 })),
    });

    const handled = await handlePublicApiRoutes({ req, res, method: 'POST', pathname: '/public/ping', deps });

    expect(handled).toBe(true);
    expect(deps.checkRateLimit).toHaveBeenCalledWith({
      userId: 'publicToken:tok-1',
      operationType: 'PUBLIC_API',
    });
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 45);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 429, {
      error: 'rate_limit_exceeded',
      message: 'Limite de requisições excedido. Tente novamente em 45 segundos.',
      retryAfter: 45,
    });
  });

  test('POST /public/* sucesso com Authorization Apikey', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'tok-2', tenantId: 'tenant-2' }));
    const recordPublicTokenUsage = jest.fn(async () => {});
    jest.doMock('../../api/services/publicAccessTokenService', () => ({
      resolvePublicToken,
      recordPublicTokenUsage,
    }));
    const { handlePublicApiRoutes } = require('../../api/modules/public-api/handlePublicApiRoutes');

    const req = { headers: { authorization: 'Apikey key-2' } };
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ orderId: 'o-1' })) });

    const handled = await handlePublicApiRoutes({ req, res, method: 'POST', pathname: '/public/orders', deps });

    expect(handled).toBe(true);
    expect(resolvePublicToken).toHaveBeenCalledWith({ token: 'key-2', allowedKinds: ['developer'] });
    expect(recordPublicTokenUsage).toHaveBeenCalledWith({
      tokenId: 'tok-2',
      route: '/public/orders',
      method: 'POST',
      statusCode: 200,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      route: '/public/orders',
      tenantId: 'tenant-2',
      tokenId: 'tok-2',
      received: { orderId: 'o-1' },
    });
  });

  test('POST /public/* nao falha quando recordPublicTokenUsage lanca erro', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'tok-3', tenantId: 'tenant-3' }));
    const recordPublicTokenUsage = jest.fn(async () => { throw new Error('usage down'); });
    jest.doMock('../../api/services/publicAccessTokenService', () => ({
      resolvePublicToken,
      recordPublicTokenUsage,
    }));
    const { handlePublicApiRoutes } = require('../../api/modules/public-api/handlePublicApiRoutes');

    const req = { headers: { 'x-api_key': 'key-3' } };
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ x: 1 })) });

    const handled = await handlePublicApiRoutes({ req, res, method: 'POST', pathname: '/public/x', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      route: '/public/x',
      tenantId: 'tenant-3',
      tokenId: 'tok-3',
      received: { x: 1 },
    });
  });

  test('POST /public/* mapeia erro interno para 500', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'tok-4', tenantId: 'tenant-4' }));
    const recordPublicTokenUsage = jest.fn(async () => {});
    jest.doMock('../../api/services/publicAccessTokenService', () => ({
      resolvePublicToken,
      recordPublicTokenUsage,
    }));
    const { handlePublicApiRoutes } = require('../../api/modules/public-api/handlePublicApiRoutes');

    const req = { headers: { 'x-api-key': 'key-4' } };
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => {
        throw new Error('invalid json');
      }),
    });

    const handled = await handlePublicApiRoutes({ req, res, method: 'POST', pathname: '/public/y', deps });

    expect(handled).toBe(true);
    expect(deps.logger.error).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 500, {
      error: 'internal_error',
      message: 'Erro ao processar request público',
    });
  });
});
