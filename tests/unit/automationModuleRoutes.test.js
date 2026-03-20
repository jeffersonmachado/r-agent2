'use strict';

const { createAutomationService } = require('../../api/modules/automation/service');
const { createAutomationController } = require('../../api/modules/automation/controller');
const { createAutomationRoutes } = require('../../api/modules/automation/routes');

describe('automation module', () => {
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

  test('router nativo monta rotas esperadas', () => {
    const router = createAutomationRoutes({ buildDeps: () => makeDeps() });
    const stack = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(stack).toEqual([
      { path: '/automations', methods: ['get'] },
      { path: '/automations', methods: ['post'] },
      { path: '/automations/:automationId/publish', methods: ['post'] },
      { path: '/automations/:automationId/run', methods: ['post'] },
    ]);
  });

  test('controller create respeita contrato atual', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ name: ' Auto ', description: 'desc' })),
    });
    const service = createAutomationService({
      automationRuntime: {
        listAutomations: jest.fn(),
        upsertAutomation: jest.fn(async () => ({ ok: true, automation: { id: 'a-1', name: 'Auto' } })),
        publishAutomation: jest.fn(),
        runAutomation: jest.fn(),
      },
    });
    const controller = createAutomationController({ service, deps });
    const req = {};
    const res = {};

    await controller.create(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      automation: { id: 'a-1', name: 'Auto' },
    });
  });

  test('controller publish retorna 404 quando nao encontra automacao', async () => {
    const deps = makeDeps();
    const service = createAutomationService({
      automationRuntime: {
        listAutomations: jest.fn(),
        upsertAutomation: jest.fn(),
        publishAutomation: jest.fn(async () => ({ ok: false, error: 'not_found' })),
        runAutomation: jest.fn(),
      },
    });
    const controller = createAutomationController({ service, deps });
    const req = { params: { automationId: 'auto-42' } };
    const res = {};

    await controller.publish(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'not_found',
      message: 'Automação não encontrada',
    });
  });
});
