describe('solutionRoutes handler', () => {
  let handleSolutionRoutes;
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
      tenantId: 'tenant1',
      headers: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    mockSvc = {
      listSolutionPacks: jest.fn(() => [{ segment: 'fitness' }]),
      installSolutionPack: jest.fn(async () => ({ success: true, installed: 3 })),
    };

    jest.doMock('../../api/services/solutions/solutionsTemplateService', () => mockSvc);
    handleSolutionRoutes = require('../../api/serverHandlers/solutionRoutes').handleSolutionRoutes;
  });

  test('retorna false para rota nao tratada', async () => {
    const handled = await handleSolutionRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps: makeDeps(),
    });

    expect(handled).toBe(false);
  });

  test('GET /api/solutions/packs retorna 401 sem auth', async () => {
    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'no token' })) });

    const handled = await handleSolutionRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/api/solutions/packs',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /api/solutions/packs retorna 403 sem permissao', async () => {
    const res = {};
    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) });

    const handled = await handleSolutionRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/api/solutions/packs',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, expect.objectContaining({ error: 'forbidden' }));
  });

  test('GET /api/solutions/packs retorna itens', async () => {
    const res = {};
    const deps = makeDeps();

    const handled = await handleSolutionRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/api/solutions/packs',
      deps,
    });

    expect(handled).toBe(true);
    expect(mockSvc.listSolutionPacks).toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true, items: expect.any(Array) }));
  });

  test('POST /api/solutions/packs/install valida content-type', async () => {
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handleSolutionRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/api/solutions/packs/install',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('POST /api/solutions/packs/install exige segment', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({})) });

    const handled = await handleSolutionRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/api/solutions/packs/install',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'segment é obrigatório');
  });

  test('POST /api/solutions/packs/install instala pack', async () => {
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ segment: 'fitness' })) });

    const handled = await handleSolutionRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/api/solutions/packs/install',
      deps,
    });

    expect(handled).toBe(true);
    expect(mockSvc.installSolutionPack).toHaveBeenCalledWith({ tenantId: 'tenant1', segment: 'fitness' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });
});
