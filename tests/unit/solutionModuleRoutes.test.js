'use strict';

describe('solution module', () => {
  let createSolutionRoutes;
  let createSolutionController;

  beforeEach(() => {
    jest.resetModules();
    ({ createSolutionRoutes } = require('../../api/modules/solution/routes'));
    ({ createSolutionController } = require('../../api/modules/solution/controller'));
  });

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

  test('router nativo monta rotas esperadas', () => {
    const router = createSolutionRoutes({ buildDeps: () => makeDeps() });
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(paths).toEqual([
      { path: '/api/solutions/packs', methods: ['get'] },
      { path: '/api/solutions/packs/install', methods: ['post'] },
    ]);
  });

  test('controller listPacks preserva retorno 200', async () => {
    const deps = makeDeps();
    const service = {
      listSolutionPacks: jest.fn(() => [{ segment: 'fitness' }]),
    };
    const controller = createSolutionController({ service, deps });
    const res = {};

    await controller.listPacks({}, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      items: [{ segment: 'fitness' }],
    });
  });

  test('controller installPack valida segment obrigatorio', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({})),
    });
    const service = {
      installSolutionPack: jest.fn(async () => ({
        ok: false,
        kind: 'bad_request',
        message: 'segment é obrigatório',
      })),
    };
    const controller = createSolutionController({ service, deps });
    const res = {};

    await controller.installPack({ tenantId: 'tenant-1' }, res);

    expect(deps.badRequest).toHaveBeenCalledWith(res, 'segment é obrigatório');
  });
});
