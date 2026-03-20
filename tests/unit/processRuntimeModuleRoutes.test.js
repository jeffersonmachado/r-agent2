'use strict';

const { createProcessRuntimeService } = require('../../api/modules/process-runtime/service');
const { createProcessRuntimeController } = require('../../api/modules/process-runtime/controller');
const { createProcessRuntimeRoutes } = require('../../api/modules/process-runtime/routes');

describe('process runtime module', () => {
  function createDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      requireTenant: jest.fn(() => 'tenant-1'),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({ processId: 'flow-1' })),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createProcessRuntimeRoutes({ buildDeps: () => createDeps() });
    const stack = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(stack).toEqual([
      '/api/process-instances',
      '/api/process-runtime/start',
      '/api/process-runtime/analytics',
      '/api/process-runtime/simulate',
      '/api/process-runtime/intelligence',
      '/api/process-instances/resume/external',
      '/api/process-instances/:executionId/history',
      '/api/process-instances/:executionId/cancel',
      '/api/process-instances/:executionId/resume',
      '/api/process-instances/:executionId',
    ]);
  });

  test('controller analytics exige processId', async () => {
    const deps = createDeps();
    const service = createProcessRuntimeService({
      durableProcessService: { getProcessAnalytics: jest.fn() },
    });
    const controller = createProcessRuntimeController({ service, deps });
    const req = { url: '/api/process-runtime/analytics' };
    const res = {};

    await controller.analytics(req, res);

    expect(deps.badRequest).toHaveBeenCalledWith(res, 'processId é obrigatório');
  });

  test('controller simulate preserva contrato de sucesso', async () => {
    const deps = createDeps();
    const service = createProcessRuntimeService({
      durableProcessService: {
        simulateProcessDefinition: jest.fn(async () => ({ ok: true, simulation: { complexityScore: 10 } })),
      },
    });
    const controller = createProcessRuntimeController({ service, deps });
    const req = { url: '/api/process-runtime/simulate' };
    const res = {};

    await controller.simulate(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { ok: true, simulation: { complexityScore: 10 } });
  });
});
