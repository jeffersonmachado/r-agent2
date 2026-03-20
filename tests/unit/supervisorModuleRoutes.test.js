'use strict';

const { createSupervisorRoutes } = require('../../api/modules/supervisor/routes');
const { createSupervisorController } = require('../../api/modules/supervisor/controller');

describe('supervisor module', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      requireTenant: jest.fn(() => 'tenant-1'),
      sendJson: jest.fn(),
      logger: { error: jest.fn() },
      getSupervisorMetrics: jest.fn(async () => ({ byAgent: [] })),
      getGeneralMetrics: jest.fn(async () => ({ totalTickets: 0 })),
      getSupervisorAgentStatus: jest.fn(async () => [{ id: 'a1' }]),
      getSupervisorQueueStatus: jest.fn(async () => [{ id: 'q1' }]),
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createSupervisorRoutes({ buildDeps: () => makeDeps() });
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(paths).toEqual([
      { path: '/supervisor/metrics', methods: ['get'] },
      { path: '/supervisor/agents/status', methods: ['get'] },
      { path: '/supervisor/queues/status', methods: ['get'] },
    ]);
  });

  test('controller metrics preserva retorno 200', async () => {
    const deps = makeDeps();
    const service = {
      getMetrics: jest.fn(async () => ({ summary: { totalTickets: 0 }, byAgent: [] })),
    };
    const controller = createSupervisorController({ service, deps });
    const res = {};

    await controller.metrics({ url: '/supervisor/metrics' }, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      summary: { totalTickets: 0 },
      byAgent: [],
    });
  });

  test('controller agentsStatus retorna 403 sem permissao', async () => {
    const deps = makeDeps({
      requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })),
    });
    const service = {
      getAgentsStatus: jest.fn(),
    };
    const controller = createSupervisorController({ service, deps });
    const res = {};

    await controller.agentsStatus({}, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, {
      error: 'forbidden',
      message: 'forbidden',
    });
  });
});
