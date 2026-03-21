describe('orderRoutes handler', () => {
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

  function makeReq(overrides = {}) {
    return {
      url: '/orders',
      tenantId: 'tenant-1',
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna false para rota nao tratada', async () => {
    jest.doMock('../../api/services/orderService', () => ({}));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const deps = makeDeps();
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res: {},
      method: 'POST',
      pathname: '/orders',
      deps,
    });

    expect(handled).toBe(false);
  });

  test('GET /orders retorna 401 sem autenticacao', async () => {
    jest.doMock('../../api/services/orderService', () => ({ listOrders: jest.fn() }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const deps = makeDeps({ requireAuth: jest.fn(() => ({ valid: false, error: 'token inválido' })) });
    const handled = await handleOrderRoutes({ req: makeReq(), res: {}, method: 'GET', pathname: '/orders', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 401, { error: 'unauthorized', message: 'token inválido' });
  });

  test('GET /orders retorna 403 sem permissao', async () => {
    jest.doMock('../../api/services/orderService', () => ({ listOrders: jest.fn() }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'sem permissao' })) });
    const handled = await handleOrderRoutes({ req: makeReq(), res: {}, method: 'GET', pathname: '/orders', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith({}, 403, { error: 'forbidden', message: 'sem permissao' });
  });

  test('GET /orders lista pedidos com filtros', async () => {
    const listOrders = jest.fn(async () => ({ items: [{ id: 'o-1' }], total: 1 }));
    jest.doMock('../../api/services/orderService', () => ({ listOrders }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const req = makeReq({ url: '/orders?status=created&limit=10&offset=20' });
    const res = {};
    const deps = makeDeps();
    const handled = await handleOrderRoutes({ req, res, method: 'GET', pathname: '/orders', deps });

    expect(handled).toBe(true);
    expect(listOrders).toHaveBeenCalledWith({ tenantId: 'tenant-1', status: 'created', limit: '10', offset: '20' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { ok: true, orders: [{ id: 'o-1' }], total: 1 });
  });

  test('GET /orders/:id retorna 404 quando pedido nao existe', async () => {
    const getOrderById = jest.fn(async () => null);
    const getDeliveryByOrderId = jest.fn();
    jest.doMock('../../api/services/orderService', () => ({ getOrderById }));
    jest.doMock('../../api/services/deliveryService', () => ({ getDeliveryByOrderId }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps();
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/orders/o-404',
      deps,
    });

    expect(handled).toBe(true);
    expect(getOrderById).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'o-404' });
    expect(getDeliveryByOrderId).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'order_not_found',
      message: 'Pedido não encontrado',
    });
  });

  test('GET /orders/:id retorna pedido com delivery', async () => {
    const getOrderById = jest.fn(async () => ({ id: 'o-2' }));
    const getDeliveryByOrderId = jest.fn(async () => ({ id: 'd-2' }));
    jest.doMock('../../api/services/orderService', () => ({ getOrderById }));
    jest.doMock('../../api/services/deliveryService', () => ({ getDeliveryByOrderId }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps();
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/orders/o-2',
      deps,
    });

    expect(handled).toBe(true);
    expect(getDeliveryByOrderId).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'o-2' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      order: { id: 'o-2' },
      delivery: { id: 'd-2' },
    });
  });

  test('GET /deliveries/:id retorna 404 quando delivery nao existe', async () => {
    const findOne = jest.fn(async () => null);
    const Delivery = jest.fn(() => ({ findOne }));
    jest.doMock('../../api/db/models', () => ({ Delivery }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps();
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/deliveries/d-404',
      deps,
    });

    expect(handled).toBe(true);
    expect(findOne).toHaveBeenCalledWith({ where: { tenant_key: 'tenant-1', id: 'd-404' } });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'delivery_not_found',
      message: 'Delivery não encontrado',
    });
  });

  test('GET /deliveries/:id retorna delivery', async () => {
    const row = { toJSON: jest.fn(() => ({ id: 'd-1' })) };
    const findOne = jest.fn(async () => row);
    const Delivery = jest.fn(() => ({ findOne }));
    jest.doMock('../../api/db/models', () => ({ Delivery }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps();
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/deliveries/d-1',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      delivery: { id: 'd-1' },
    });
  });

  test('PUT /deliveries/:id/status valida content-type', async () => {
    jest.doMock('../../api/services/deliveryService', () => ({ updateDeliveryStatus: jest.fn() }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'PUT',
      pathname: '/deliveries/d-ct/status',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('PUT /deliveries/:id/status mapeia not_found para 404', async () => {
    const updateDeliveryStatus = jest.fn(async () => {
      const err = new Error('missing');
      err.code = 'delivery_not_found';
      throw err;
    });
    jest.doMock('../../api/services/deliveryService', () => ({ updateDeliveryStatus }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ status: 'delivered' })) });
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'PUT',
      pathname: '/deliveries/d-404/status',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'delivery_not_found',
      message: 'Delivery não encontrado',
    });
  });

  test('PUT /deliveries/:id/status atualiza status', async () => {
    const updateDeliveryStatus = jest.fn(async () => ({ id: 'd-2', status: 'delivered' }));
    jest.doMock('../../api/services/deliveryService', () => ({ updateDeliveryStatus }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ status: ' delivered ' })) });
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'PUT',
      pathname: '/deliveries/d-2/status',
      deps,
    });

    expect(handled).toBe(true);
    expect(updateDeliveryStatus).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      deliveryId: 'd-2',
      status: 'delivered',
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      delivery: { id: 'd-2', status: 'delivered' },
    });
  });

  test('PUT /orders/:id/status mapeia invalid_transition para 400', async () => {
    const updateOrderStatus = jest.fn(async () => {
      const err = new Error('invalid');
      err.code = 'invalid_order_status_transition';
      err.details = { from: 'created', to: 'done' };
      throw err;
    });
    jest.doMock('../../api/services/orderService', () => ({ updateOrderStatus }));
    jest.doMock('../../api/services/deliveryService', () => ({
      getDeliveryByOrderId: jest.fn(),
      updateDeliveryStatus: jest.fn(),
    }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ status: 'done' })) });
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'PUT',
      pathname: '/orders/o-400/status',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 400, {
      error: 'invalid_transition',
      message: 'Transição de status inválida',
      details: { from: 'created', to: 'done' },
    });
  });

  test('PUT /orders/:id/status atualiza pedido e sincroniza delivery', async () => {
    const updateOrderStatus = jest.fn(async () => ({ id: 'o-3', status: 'dispatched' }));
    const getDeliveryByOrderId = jest.fn(async () => ({ id: 'd-3' }));
    const updateDeliveryStatus = jest.fn(async () => ({ id: 'd-3', status: 'dispatched' }));

    jest.doMock('../../api/services/orderService', () => ({ updateOrderStatus }));
    jest.doMock('../../api/services/deliveryService', () => ({
      getDeliveryByOrderId,
      updateDeliveryStatus,
    }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ status: 'dispatched' })) });
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'PUT',
      pathname: '/orders/o-3/status',
      deps,
    });

    expect(handled).toBe(true);
    expect(updateOrderStatus).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'o-3', status: 'dispatched' });
    expect(getDeliveryByOrderId).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'o-3' });
    expect(updateDeliveryStatus).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      deliveryId: 'd-3',
      status: 'dispatched',
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      order: { id: 'o-3', status: 'dispatched' },
    });
  });

  test('POST /orders/:id/incidents valida content-type', async () => {
    jest.doMock('../../api/services/orderService', () => ({ getOrderById: jest.fn() }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/orders/o-ct/incidents',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /orders/:id/incidents retorna 404 quando pedido nao existe', async () => {
    const getOrderById = jest.fn(async () => null);
    jest.doMock('../../api/services/orderService', () => ({ getOrderById, getOrderIncident: jest.fn() }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps();
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/orders/o-404/incidents',
      deps,
    });

    expect(handled).toBe(true);
    expect(getOrderById).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'o-404' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'order_not_found',
      message: 'Pedido não encontrado',
    });
  });

  test('POST /orders/:id/incidents devolve incidente idempotente aberto', async () => {
    const getOrderById = jest.fn(async () => ({ id: 'o-7', order_number: '0007' }));
    const getOrderIncident = jest.fn(async () => ({ ticketId: 't-existing', status: 'open' }));
    jest.doMock('../../api/services/orderService', () => ({ getOrderById, getOrderIncident }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const deps = makeDeps({ getTicket: jest.fn(() => ({ id: 't-existing', queue: 'Delivery' })) });
    const handled = await handleOrderRoutes({
      req: makeReq(),
      res,
      method: 'POST',
      pathname: '/orders/o-7/incidents',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.createTicket).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      idempotent: true,
      ticketId: 't-existing',
      ticket: { id: 't-existing', queue: 'Delivery' },
    });
  });

  test('POST /orders/:id/incidents cria ticket, persiste incidente e emite evento', async () => {
    const getOrderById = jest.fn(async () => ({ id: 'o-9', order_number: '0009', context: { correlationId: 'corr-9' } }));
    const getOrderIncident = jest.fn(async () => null);
    const setOrderIncident = jest.fn(async () => null);
    const appendEventV1 = jest.fn(async () => null);

    jest.doMock('../../api/services/orderService', () => ({
      getOrderById,
      getOrderIncident,
      setOrderIncident,
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({ appendEventV1 }));
    const { handleOrderRoutes } = require('../../api/modules/order/handleOrderRoutes');

    const res = {};
    const req = makeReq({ agent: { id: 'agent-1' } });
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        queue: 'Support',
        type: 'delay',
        message: 'Atraso critico',
        idempotencyKey: 'idem-9',
      })),
      createTicket: jest.fn(() => ({ id: 't-new' })),
    });

    const handled = await handleOrderRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/orders/o-9/incidents',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      sessionId: 'order_o-9',
      queue: 'Support',
      lastUserMessage: 'Atraso critico',
    }));
    expect(setOrderIncident).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      orderId: 'o-9',
      incident: expect.objectContaining({
        ticketId: 't-new',
        type: 'delay',
        queue: 'Support',
        status: 'open',
      }),
    }));
    expect(appendEventV1).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      type: 'SupportIncidentOpened',
      payload: expect.objectContaining({
        ticketId: 't-new',
        orderId: 'o-9',
        incidentType: 'delay',
        queue: 'Support',
      }),
    }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, { ok: true, ticket: { id: 't-new' } });
  });
});