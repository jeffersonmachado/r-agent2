'use strict';

const { createSlaRoutes } = require('../../api/modules/sla/routes');
const { createSlaController } = require('../../api/modules/sla/controller');

describe('sla module', () => {
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
    const router = createSlaRoutes({ buildDeps: () => makeDeps() });
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(paths).toEqual([
      { path: '/sla/policies', methods: ['get'] },
      { path: '/sla/policies', methods: ['post'] },
      { path: '/sla/breaches', methods: ['get'] },
    ]);
  });

  test('controller savePolicy valida name obrigatorio', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ description: 'x' })),
    });
    const service = {
      upsertPolicy: jest.fn(async () => ({
        ok: false,
        kind: 'bad_request',
        message: 'name é obrigatório',
      })),
    };
    const controller = createSlaController({ service, deps });
    const res = {};

    await controller.savePolicy({}, res);

    expect(deps.badRequest).toHaveBeenCalledWith(res, 'name é obrigatório');
  });

  test('controller listBreaches preserva retorno 200', async () => {
    const deps = makeDeps();
    const service = {
      listBreaches: jest.fn(async () => ({ ok: true, breaches: [{ id: 'b-1' }] })),
    };
    const controller = createSlaController({ service, deps });
    const res = {};

    await controller.listBreaches({}, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      breaches: [{ id: 'b-1' }],
    });
  });
});
