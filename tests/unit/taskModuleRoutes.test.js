'use strict';

const { createTaskRoutes } = require('../../api/modules/task/routes');
const { createTaskController } = require('../../api/modules/task/controller');

describe('task module', () => {
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
    const router = createTaskRoutes({ buildDeps: () => makeDeps() });
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(paths).toEqual([
      { path: '/tasks', methods: ['get'] },
      { path: '/tasks', methods: ['post'] },
      { path: '/tasks/:taskId/complete', methods: ['post'] },
      { path: '/tasks/:taskId/reminder', methods: ['post'] },
    ]);
  });

  test('controller create valida title obrigatorio', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ description: 'x' })),
    });
    const service = {
      createTask: jest.fn(async () => ({
        ok: false,
        kind: 'bad_request',
        message: 'title é obrigatório',
      })),
    };
    const controller = createTaskController({ service, deps });
    const res = {};

    await controller.create({}, res);

    expect(deps.badRequest).toHaveBeenCalledWith(res, 'title é obrigatório');
  });

  test('controller complete preserva retorno 404', async () => {
    const deps = makeDeps();
    const service = {
      completeTask: jest.fn(async () => ({
        ok: false,
        status: 404,
        payload: { error: 'not_found', message: 'Tarefa não encontrada' },
      })),
    };
    const controller = createTaskController({ service, deps });
    const res = {};

    await controller.complete({ params: { taskId: 'task-2' } }, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'not_found',
      message: 'Tarefa não encontrada',
    });
  });
});
