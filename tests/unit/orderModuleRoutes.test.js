'use strict';

const { createOrderService } = require('../../api/modules/order/service');
const { createOrderController } = require('../../api/modules/order/controller');
const { createOrderRoutes } = require('../../api/modules/order/routes');

describe('order module', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      createTicket: jest.fn(() => ({ id: 't-1' })),
      getTicket: jest.fn(() => null),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createOrderRoutes({ buildDeps: () => makeDeps() });
    const stack = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(stack).toEqual([
      '/orders',
      '/orders/:orderId',
      '/deliveries/:deliveryId',
      '/deliveries/:deliveryId/status',
      '/orders/:orderId/status',
      '/orders/:orderId/incidents',
    ]);
  });

  test('controller list preserva contrato de listagem', async () => {
    const deps = makeDeps();
    const service = createOrderService({
      orderService: { listOrders: jest.fn(async () => ({ items: [{ id: 'o-1' }], total: 1 })) },
      deliveryService: {},
      dbModels: {},
      eventLedgerService: {},
    });
    const controller = createOrderController({ service, deps });
    const req = { tenantId: 'tenant-1', url: '/orders?status=created' };
    const res = {};

    await controller.list(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { ok: true, orders: [{ id: 'o-1' }], total: 1 });
  });

  test('controller getOrder retorna 404 quando pedido nao existe', async () => {
    const deps = makeDeps();
    const service = createOrderService({
      orderService: { getOrderById: jest.fn(async () => null) },
      deliveryService: { getDeliveryByOrderId: jest.fn() },
      dbModels: {},
      eventLedgerService: {},
    });
    const controller = createOrderController({ service, deps });
    const req = { tenantId: 'tenant-1', params: { orderId: 'o-404' } };
    const res = {};

    await controller.getOrder(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'order_not_found',
      message: 'Pedido não encontrado',
    });
  });
});
