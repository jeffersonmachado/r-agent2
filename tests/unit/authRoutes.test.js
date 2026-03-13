describe('authRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      validateInput: jest.fn((body) => body),
      schemas: { login: {} },
      ValidationError: class ValidationError extends Error {},
      authLogin: jest.fn(async () => ({ success: true, token: 'tok', agent: { id: 'a1', username: 'alice' } })),
      loginWithRpaToken: jest.fn(async () => ({ success: true, token: 'rtok', agent: { id: 'a1', username: 'alice' } })),
      validateToken: jest.fn(() => ({ valid: true, agent: { id: 'a1', username: 'alice' } })),
      authLogout: jest.fn(() => ({ success: true })),
      logoutAllSessions: jest.fn(() => 3),
      logAction: jest.fn(),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // ── rota não tratada ───────────────────────────────────────────────────────

  test('retorna false para rota nao tratada', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const handled = await handleAuthRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/auth/unknown',
      deps: makeDeps(),
    });

    expect(handled).toBe(false);
  });

  // ── POST /auth/login ─────────────────────────────────────────────────────

  test('POST /auth/login valida content-type', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });
    const handled = await handleAuthRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/login', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, expect.stringContaining('Content-Type'));
  });

  test('POST /auth/login retorna 401 para credenciais invalidas', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ username: 'alice', password: 'wrong' })),
      validateInput: jest.fn((body) => body),
      authLogin: jest.fn(async () => ({ success: false, error: 'invalid credentials' })),
    });
    const handled = await handleAuthRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/login', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'authentication_failed' }));
  });

  test('POST /auth/login retorna token e agent no sucesso', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const agent = { id: 'a1', username: 'alice' };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ username: 'alice', password: 'pass' })),
      validateInput: jest.fn((body) => body),
      authLogin: jest.fn(async () => ({ success: true, token: 'tok', agent })),
    });
    const handled = await handleAuthRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/login', deps });

    expect(handled).toBe(true);
    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'login' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { token: 'tok', agent });
  });

  test('POST /auth/login retorna badRequest para ValidationError', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    class VE extends Error {}
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({})),
      ValidationError: VE,
      validateInput: jest.fn(() => { throw new VE('campo obrigatório'); }),
    });
    const handled = await handleAuthRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/login', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'campo obrigatório');
  });

  // ── POST /auth/rpa/login ─────────────────────────────────────────────────

  test('POST /auth/rpa/login valida content-type', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });
    const handled = await handleAuthRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/rpa/login', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, expect.stringContaining('Content-Type'));
  });

  test('POST /auth/rpa/login exige rpaToken', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ tenantId: 't1' })) });
    const handled = await handleAuthRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/rpa/login', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, expect.stringContaining('Token RPA'));
  });

  test('POST /auth/rpa/login exige tenantId', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ token: 'rpa-tok' })) });
    const handled = await handleAuthRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/rpa/login', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, expect.stringContaining('tenantId'));
  });

  test('POST /auth/rpa/login retorna 401 para token invalido', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ token: 'bad', tenantId: 't1' })),
      loginWithRpaToken: jest.fn(async () => ({ success: false, error: 'invalid rpa token' })),
    });
    const handled = await handleAuthRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/rpa/login', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'rpa_authentication_failed' }));
  });

  test('POST /auth/rpa/login autentica com sucesso', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const agent = { id: 'a1', username: 'rpa-user' };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ token: 'rpa-tok', tenantId: 't1' })),
      loginWithRpaToken: jest.fn(async () => ({ success: true, token: 'jwt', agent })),
    });
    const handled = await handleAuthRoutes({ req: makeReq(), res, method: 'POST', pathname: '/auth/rpa/login', deps });

    expect(handled).toBe(true);
    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'rpa_login' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { token: 'jwt', agent });
  });

  // ── POST /auth/logout ────────────────────────────────────────────────────

  test('POST /auth/logout retorna 401 sem token', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const handled = await handleAuthRoutes({
      req: makeReq({ headers: {} }),
      res,
      method: 'POST',
      pathname: '/auth/logout',
      deps: makeDeps(),
    });

    expect(handled).toBe(true);
    expect(makeDeps().sendJson).not.toHaveBeenCalled(); // via own deps
  });

  test('POST /auth/logout encerra sessao com token invalido (idempotente)', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({
      validateToken: jest.fn(() => ({ valid: false })),
      authLogout: jest.fn(() => ({ success: true })),
    });
    const handled = await handleAuthRoutes({
      req: makeReq({ headers: { authorization: 'Bearer bad-token' } }),
      res,
      method: 'POST',
      pathname: '/auth/logout',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.authLogout).toHaveBeenCalledWith('bad-token');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  test('POST /auth/logout encerra sessao com token valido', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps();
    const handled = await handleAuthRoutes({
      req: makeReq({ headers: { authorization: 'Bearer valid-token' } }),
      res,
      method: 'POST',
      pathname: '/auth/logout',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'logout' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { success: true });
  });

  // ── POST /auth/logout-all ────────────────────────────────────────────────

  test('POST /auth/logout-all retorna 401 sem token', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps();
    const handled = await handleAuthRoutes({
      req: makeReq({ headers: {} }),
      res,
      method: 'POST',
      pathname: '/auth/logout-all',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('POST /auth/logout-all retorna 401 para token invalido', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({ validateToken: jest.fn(() => ({ valid: false, error: 'expirado' })) });
    const handled = await handleAuthRoutes({
      req: makeReq({ headers: { authorization: 'Bearer tok' } }),
      res,
      method: 'POST',
      pathname: '/auth/logout-all',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('POST /auth/logout-all encerra todas as sessoes', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({ logoutAllSessions: jest.fn(() => 5) });
    const handled = await handleAuthRoutes({
      req: makeReq({ headers: { authorization: 'Bearer tok' } }),
      res,
      method: 'POST',
      pathname: '/auth/logout-all',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'logout_all' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ sessionsRemoved: 5 }));
  });

  // ── GET /auth/me ─────────────────────────────────────────────────────────

  test('GET /auth/me retorna 401 sem token', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps();
    const handled = await handleAuthRoutes({
      req: makeReq({ headers: {} }),
      res,
      method: 'GET',
      pathname: '/auth/me',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /auth/me retorna 401 para token invalido', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const deps = makeDeps({ validateToken: jest.fn(() => ({ valid: false, error: 'expirado' })) });
    const handled = await handleAuthRoutes({
      req: makeReq({ headers: { authorization: 'Bearer tok' } }),
      res,
      method: 'GET',
      pathname: '/auth/me',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /auth/me retorna agent autenticado', async () => {
    const { handleAuthRoutes } = require('../../api/serverHandlers/authRoutes');

    const res = {};
    const agent = { id: 'a1', username: 'alice' };
    const deps = makeDeps({ validateToken: jest.fn(() => ({ valid: true, agent })) });
    const handled = await handleAuthRoutes({
      req: makeReq({ headers: { authorization: 'Bearer good-token' } }),
      res,
      method: 'GET',
      pathname: '/auth/me',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { agent });
  });
});
