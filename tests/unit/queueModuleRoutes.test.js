'use strict';

const { createQueueController } = require('../../api/modules/queue/controller');
const { createQueueService } = require('../../api/modules/queue/service');
const { createQueueRoutes } = require('../../api/modules/queue/routes');

describe('queue module', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      listQueues: jest.fn(() => ['Support', 'Sales']),
      createQueue: jest.fn(() => ({ success: true, queueName: 'newq', message: 'Fila criada' })),
      getQueueInfo: jest.fn(() => ({ name: 'support', size: 3 })),
      deleteQueue: jest.fn(() => ({ success: true, message: 'deletada' })),
      listQueue: jest.fn(() => []),
      canAccessTicket: jest.fn(() => true),
      queueDefinitionService: {
        listQueues: jest.fn(() => [{ name: 'Delivery' }, { name: 'Support' }]),
        upsertQueue: jest.fn(async () => {}),
      },
      logAction: jest.fn(),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      tenantId: 'tenant-1',
      url: '/',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      agent: { id: 'agent-1', username: 'alice', role: 'admin' },
      params: {},
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createQueueRoutes({ buildDeps: () => makeDeps() });
    const stack = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(stack).toEqual([
      { path: '/queues', methods: ['get'] },
      { path: '/queues', methods: ['post'] },
      { path: '/queues/:queueName/tickets', methods: ['get'] },
      { path: '/queues/:queueName', methods: ['get'] },
      { path: '/queues/:queueName', methods: ['delete'] },
    ]);
  });

  test('controller list faz merge de filas legadas e persistidas', async () => {
    const deps = makeDeps();
    const service = createQueueService({ deps });
    const controller = createQueueController({ service, deps });
    const req = makeReq();
    const res = {};

    await controller.list(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, ['Delivery', 'Sales', 'Support']);
  });

  test('controller create preserva auditoria e status 201', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ name: 'VIP' })),
      createQueue: jest.fn(() => ({ success: true, queueName: 'VIP', message: 'Fila criada' })),
    });
    const service = createQueueService({ deps });
    const controller = createQueueController({ service, deps });
    const req = makeReq();
    const res = {};

    await controller.create(req, res);

    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'queue_create', resourceId: 'VIP' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, expect.objectContaining({ success: true, queueName: 'VIP' }));
  });
});
