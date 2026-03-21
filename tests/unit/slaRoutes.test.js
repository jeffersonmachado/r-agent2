describe('slaRoutes handler', () => {
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
    jest.doMock('../../api/services/slaService', () => ({}));
    const { handleSlaRoutes } = require('../../api/modules/sla/handleSlaRoutes');

    const deps = makeDeps();
    const handled = await handleSlaRoutes({
      req: {},
      res: {},
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
  });

  test('GET /sla/policies retorna 403 sem permissao', async () => {
    jest.doMock('../../api/services/slaService', () => ({ listPolicies: jest.fn() }));
    const { handleSlaRoutes } = require('../../api/modules/sla/handleSlaRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) });

    const handled = await handleSlaRoutes({ req, res, method: 'GET', pathname: '/sla/policies', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, {
      error: 'forbidden',
      message: 'forbidden',
    });
  });

  test('POST /sla/policies valida content-type', async () => {
    const upsertPolicy = jest.fn(async () => ({ ok: true, policy: { id: 'p-1' } }));
    jest.doMock('../../api/services/slaService', () => ({ upsertPolicy }));
    const { handleSlaRoutes } = require('../../api/modules/sla/handleSlaRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handleSlaRoutes({ req, res, method: 'POST', pathname: '/sla/policies', deps });

    expect(handled).toBe(true);
    expect(upsertPolicy).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /sla/policies exige name', async () => {
    const upsertPolicy = jest.fn(async () => ({ ok: true, policy: { id: 'p-1' } }));
    jest.doMock('../../api/services/slaService', () => ({ upsertPolicy }));
    const { handleSlaRoutes } = require('../../api/modules/sla/handleSlaRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ description: 'x' })) });

    const handled = await handleSlaRoutes({ req, res, method: 'POST', pathname: '/sla/policies', deps });

    expect(handled).toBe(true);
    expect(upsertPolicy).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'name é obrigatório');
  });

  test('POST /sla/policies salva policy', async () => {
    const upsertPolicy = jest.fn(async () => ({ ok: true, policy: { id: 'policy-1', name: 'Premium' } }));
    jest.doMock('../../api/services/slaService', () => ({ upsertPolicy }));
    const { handleSlaRoutes } = require('../../api/modules/sla/handleSlaRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        id: 'policy-1',
        name: '  Premium  ',
        description: 'desc',
        customerSegment: 'enterprise',
        responseTimeMin: 15,
        resolutionTimeMin: 60,
        enabled: false,
      })),
    });

    const handled = await handleSlaRoutes({ req, res, method: 'POST', pathname: '/sla/policies', deps });

    expect(handled).toBe(true);
    expect(upsertPolicy).toHaveBeenCalledWith('tenant-1', {
      id: 'policy-1',
      name: 'Premium',
      description: 'desc',
      customerSegment: 'enterprise',
      responseTimeMin: 15,
      resolutionTimeMin: 60,
      enabled: false,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      policy: { id: 'policy-1', name: 'Premium' },
    });
  });

  test('GET /sla/breaches mapeia indisponibilidade para 503', async () => {
    const listBreaches = jest.fn(async () => ({ ok: false }));
    jest.doMock('../../api/services/slaService', () => ({ listBreaches }));
    const { handleSlaRoutes } = require('../../api/modules/sla/handleSlaRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps();

    const handled = await handleSlaRoutes({ req, res, method: 'GET', pathname: '/sla/breaches', deps });

    expect(handled).toBe(true);
    expect(listBreaches).toHaveBeenCalledWith('tenant-1');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 503, {
      error: 'service_unavailable',
      message: 'sla_unavailable',
    });
  });

  test('GET /sla/breaches retorna lista', async () => {
    const listBreaches = jest.fn(async () => ({ ok: true, breaches: [{ id: 'b-1' }] }));
    jest.doMock('../../api/services/slaService', () => ({ listBreaches }));
    const { handleSlaRoutes } = require('../../api/modules/sla/handleSlaRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps();

    const handled = await handleSlaRoutes({ req, res, method: 'GET', pathname: '/sla/breaches', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      breaches: [{ id: 'b-1' }],
    });
  });
});
