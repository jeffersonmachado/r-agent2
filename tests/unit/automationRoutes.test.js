describe('automationRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      requireTenant: jest.fn(() => 'tenant-1'),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna false para rota nao tratada', async () => {
    jest.doMock('../../api/services/automationService', () => ({}));
    const { handleAutomationRoutes } = require('../../api/serverHandlers/automationRoutes');

    const deps = makeDeps();
    const handled = await handleAutomationRoutes({
      req: {},
      res: {},
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
  });

  test('GET /automations retorna 401 quando nao autenticado', async () => {
    jest.doMock('../../api/services/automationService', () => ({ listAutomations: jest.fn() }));
    const { handleAutomationRoutes } = require('../../api/serverHandlers/automationRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'invalid_token' })) });

    const handled = await handleAutomationRoutes({ req, res, method: 'GET', pathname: '/automations', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'invalid_token',
    });
  });

  test('POST /automations valida content-type', async () => {
    const upsertAutomation = jest.fn(async () => ({ ok: true, automation: { id: 'a1' } }));
    jest.doMock('../../api/services/automationService', () => ({ upsertAutomation }));
    const { handleAutomationRoutes } = require('../../api/serverHandlers/automationRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handleAutomationRoutes({ req, res, method: 'POST', pathname: '/automations', deps });

    expect(handled).toBe(true);
    expect(upsertAutomation).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /automations exige name', async () => {
    const upsertAutomation = jest.fn(async () => ({ ok: true, automation: { id: 'a1' } }));
    jest.doMock('../../api/services/automationService', () => ({ upsertAutomation }));
    const { handleAutomationRoutes } = require('../../api/serverHandlers/automationRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ description: 'x' })) });

    const handled = await handleAutomationRoutes({ req, res, method: 'POST', pathname: '/automations', deps });

    expect(handled).toBe(true);
    expect(upsertAutomation).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'name é obrigatório');
  });

  test('POST /automations salva automacao', async () => {
    const upsertAutomation = jest.fn(async () => ({ ok: true, automation: { id: 'a-1', name: 'Auto 1' } }));
    jest.doMock('../../api/services/automationService', () => ({ upsertAutomation }));
    const { handleAutomationRoutes } = require('../../api/serverHandlers/automationRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        name: '  Auto 1  ',
        description: 'desc',
        status: 'draft',
        definition: { steps: [] },
      })),
    });

    const handled = await handleAutomationRoutes({ req, res, method: 'POST', pathname: '/automations', deps });

    expect(handled).toBe(true);
    expect(upsertAutomation).toHaveBeenCalledWith('tenant-1', {
      id: null,
      name: 'Auto 1',
      description: 'desc',
      status: 'draft',
      definition: { steps: [] },
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      automation: { id: 'a-1', name: 'Auto 1' },
    });
  });

  test('POST /automations/:id/publish retorna 404 quando not_found', async () => {
    const publishAutomation = jest.fn(async () => ({ ok: false, error: 'not_found' }));
    jest.doMock('../../api/services/automationService', () => ({ publishAutomation }));
    const { handleAutomationRoutes } = require('../../api/serverHandlers/automationRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps();

    const handled = await handleAutomationRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/automations/auto-42/publish',
      deps,
    });

    expect(handled).toBe(true);
    expect(publishAutomation).toHaveBeenCalledWith('tenant-1', 'auto-42');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'not_found',
      message: 'Automação não encontrada',
    });
  });

  test('POST /automations/:id/run retorna payload de execucao', async () => {
    const runAutomation = jest.fn(async () => ({
      ok: true,
      automation: { id: 'auto-7' },
      run: { id: 'run-1', status: 'done' },
    }));
    jest.doMock('../../api/services/automationService', () => ({ runAutomation }));
    const { handleAutomationRoutes } = require('../../api/serverHandlers/automationRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps();

    const handled = await handleAutomationRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/automations/auto-7/run',
      deps,
    });

    expect(handled).toBe(true);
    expect(runAutomation).toHaveBeenCalledWith('tenant-1', 'auto-7');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      automation: { id: 'auto-7' },
      run: { id: 'run-1', status: 'done' },
    });
  });
});
