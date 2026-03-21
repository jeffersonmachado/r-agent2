describe('auditRoutes handler', () => {
  let handleAuditRoutes;

  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      queryLogs: jest.fn(async () => ({ logs: [], total: 0 })),
      getAuditStats: jest.fn(async () => ({ total: 10 })),
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      url: '/audit/logs',
      tenantId: 'tenant1',
      headers: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handleAuditRoutes = require('../../api/modules/domain-identity/handleAuditRoutes').handleAuditRoutes;
  });

  test('retorna false para rota nao tratada', async () => {
    const handled = await handleAuditRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps: makeDeps(),
    });

    expect(handled).toBe(false);
  });

  test('GET /audit/logs retorna 401 sem auth', async () => {
    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'no token' })) });

    const handled = await handleAuditRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/audit/logs',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /audit/logs retorna 403 sem permissao', async () => {
    const res = {};
    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) });

    const handled = await handleAuditRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/audit/logs',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('GET /audit/logs consulta logs com filtros e tenant', async () => {
    const res = {};
    const deps = makeDeps();
    const req = makeReq({ url: '/audit/logs?action=ticket_update&limit=50' });

    const handled = await handleAuditRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/audit/logs',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.queryLogs).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ticket_update',
      limit: '50',
      tenantId: 'tenant1',
    }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ logs: expect.any(Array) }));
  });

  test('GET /audit/stats retorna 401 sem auth', async () => {
    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'no token' })) });

    const handled = await handleAuditRoutes({
      req: makeReq({ url: '/audit/stats' }),
      res,
      method: 'GET',
      pathname: '/audit/stats',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /audit/stats retorna 403 sem permissao', async () => {
    const res = {};
    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) });

    const handled = await handleAuditRoutes({
      req: makeReq({ url: '/audit/stats' }),
      res,
      method: 'GET',
      pathname: '/audit/stats',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('GET /audit/stats retorna estatisticas', async () => {
    const res = {};
    const deps = makeDeps({ getAuditStats: jest.fn(async () => ({ total: 123 })) });

    const handled = await handleAuditRoutes({
      req: makeReq({ url: '/audit/stats' }),
      res,
      method: 'GET',
      pathname: '/audit/stats',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.getAuditStats).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ total: 123 }));
  });
});
