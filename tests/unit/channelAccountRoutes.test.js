describe('channelAccountRoutes handler', () => {
  let handleChannelAccountRoutes;
  let mockSvc;

  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      url: '/',
      tenantId: 'tenant1',
      agent: { id: 'a1', username: 'alice', role: 'admin' },
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockSvc = {
      listAccounts: jest.fn(async () => [{ id: 'acc1' }]),
      createAccount: jest.fn(async () => ({ success: true, account: { id: 'acc1' } })),
      testAccountConnection: jest.fn(async () => ({ success: true, latency: 42 })),
      updateAccount: jest.fn(async () => ({ success: true, account: { id: 'acc1' } })),
      deleteAccount: jest.fn(async () => ({ success: true })),
    };

    jest.doMock('../../api/services/channelAccountsService', () => mockSvc);
    handleChannelAccountRoutes = require('../../api/modules/platform-admin/handleChannelAccountRoutes').handleChannelAccountRoutes;
  });

  // ── rota não tratada ────────────────────────────────────────────────────

  test('retorna false para rota nao tratada', async () => {
    const handled = await handleChannelAccountRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other/route',
      deps: makeDeps(),
    });
    expect(handled).toBe(false);
  });

  // ── GET /channel-accounts ───────────────────────────────────────────────

  test('GET /channel-accounts retorna 401 sem auth', async () => {
    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'no token' })) });
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'GET', pathname: '/channel-accounts', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /channel-accounts retorna 403 sem permissao', async () => {
    const res = {};
    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) });
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'GET', pathname: '/channel-accounts', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('GET /channel-accounts retorna lista de accounts', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleChannelAccountRoutes({ req: makeReq({ url: '/channel-accounts' }), res, method: 'GET', pathname: '/channel-accounts', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ accounts: expect.any(Array) }));
  });

  // ── POST /channel-accounts ──────────────────────────────────────────────

  test('POST /channel-accounts valida content-type', async () => {
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'POST', pathname: '/channel-accounts', deps });
    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /channel-accounts cria account com sucesso', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ type: 'whatsapp', externalId: 'ext1' })) });
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'POST', pathname: '/channel-accounts', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, expect.objectContaining({ success: true }));
  });

  test('POST /channel-accounts retorna 400 em falha do servico', async () => {
    mockSvc.createAccount = jest.fn(async () => ({ success: false, error: 'duplicate' }));
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ type: 'whatsapp' })) });
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'POST', pathname: '/channel-accounts', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 400, expect.objectContaining({ error: 'duplicate' }));
  });

  // ── POST /channel-accounts/:id/test ────────────────────────────────────

  test('POST /channel-accounts/:id/test retorna 200 em sucesso', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'POST', pathname: '/channel-accounts/acc1/test', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  test('POST /channel-accounts/:id/test retorna 404 se nao encontrado', async () => {
    mockSvc.testAccountConnection = jest.fn(async () => ({ success: false, error: 'not_found' }));
    const res = {};
    const deps = makeDeps();
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'POST', pathname: '/channel-accounts/acc1/test', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, expect.objectContaining({ error: 'not_found' }));
  });

  test('POST /channel-accounts/:id/test retorna 502 em erro upstream', async () => {
    mockSvc.testAccountConnection = jest.fn(async () => ({ success: false, error: 'upstream_error', message: 'timeout' }));
    const res = {};
    const deps = makeDeps();
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'POST', pathname: '/channel-accounts/acc1/test', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 502, expect.objectContaining({ error: 'upstream_error' }));
  });

  // ── PUT /channel-accounts/:id ───────────────────────────────────────────

  test('PUT /channel-accounts/:id atualiza com sucesso', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ status: 'active' })) });
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'PUT', pathname: '/channel-accounts/acc1', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  test('PUT /channel-accounts/:id retorna 404 se nao encontrado', async () => {
    mockSvc.updateAccount = jest.fn(async () => ({ success: false, error: 'not_found' }));
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({})) });
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'PUT', pathname: '/channel-accounts/acc1', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, expect.objectContaining({ error: 'not_found' }));
  });

  // ── DELETE /channel-accounts/:id ───────────────────────────────────────

  test('DELETE /channel-accounts/:id remove com sucesso', async () => {
    const res = {};
    const deps = makeDeps();
    const handled = await handleChannelAccountRoutes({ req: makeReq(), res, method: 'DELETE', pathname: '/channel-accounts/acc1', deps });
    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });
});
