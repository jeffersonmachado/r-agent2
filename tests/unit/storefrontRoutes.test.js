describe('storefrontRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      checkRateLimit: jest.fn(async () => ({ allowed: true })),
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      url: '/x',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna false para rota nao tratada', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({}));
    const { handleStorefrontRoutes } = require('../../api/modules/platform-public/handleStorefrontRoutes');

    const deps = makeDeps();
    const handled = await handleStorefrontRoutes({
      req: makeReq(),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
  });

  test('POST /storefront/orders valida content-type', async () => {
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken: jest.fn() }));
    const { handleStorefrontRoutes } = require('../../api/modules/platform-public/handleStorefrontRoutes');

    const req = makeReq();
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handleStorefrontRoutes({ req, res, method: 'POST', pathname: '/storefront/orders', deps });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /storefront/orders retorna 401 quando token ausente', async () => {
    const resolvePublicToken = jest.fn();
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    const { handleStorefrontRoutes } = require('../../api/modules/platform-public/handleStorefrontRoutes');

    const req = makeReq({ url: '/storefront/orders' });
    const res = {};
    const deps = makeDeps();

    const handled = await handleStorefrontRoutes({ req, res, method: 'POST', pathname: '/storefront/orders', deps });

    expect(handled).toBe(true);
    expect(resolvePublicToken).not.toHaveBeenCalled();
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, {
      error: 'unauthorized',
      message: 'Token obrigatório',
    });
  });

  test('POST /storefront/orders retorna 429 no rate limit', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-1', tenantId: 't-1', locationId: 'l-1' }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    const { handleStorefrontRoutes } = require('../../api/modules/platform-public/handleStorefrontRoutes');

    const req = makeReq({ url: '/storefront/orders?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ checkRateLimit: jest.fn(async () => ({ allowed: false, retryAfter: 12 })) });

    const handled = await handleStorefrontRoutes({ req, res, method: 'POST', pathname: '/storefront/orders', deps });

    expect(handled).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 12);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 429, {
      error: 'rate_limit_exceeded',
      message: 'Limite de requisições excedido. Tente novamente em 12 segundos.',
      retryAfter: 12,
    });
  });

  test('POST /storefront/orders cria pedido e delivery', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-2', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const createOrder = jest.fn(async () => ({ id: 'ord-1', context: { correlationId: 'corr-1' } }));
    const createDeliveryForOrder = jest.fn(async () => ({ id: 'del-1' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/orderService', () => ({ createOrder }));
    jest.doMock('../../api/services/deliveryService', () => ({ createDeliveryForOrder }));
    const { handleStorefrontRoutes } = require('../../api/modules/platform-public/handleStorefrontRoutes');

    const req = makeReq({ url: '/storefront/orders?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        customerName: '  Joao  ',
        customerPhone: '  9999  ',
        notes: '  sem cebola ',
        items: [{ sku: '1', qty: 1 }],
        idempotencyKey: ' idem-1 ',
        deliveryType: 'delivery',
        deliveryAddress: { line1: 'Rua A' },
        attribution: {
          utm_source: 'google',
          utm_campaign: 'search brand',
          utm_term: 'crm brand',
          gclid: 'gclid-123',
          campaignId: 'cmp-1',
          keywordText: 'crm brand',
        },
      })),
    });

    const handled = await handleStorefrontRoutes({ req, res, method: 'POST', pathname: '/storefront/orders', deps });

    expect(handled).toBe(true);
    expect(createOrder).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      source: 'storefront',
      locationId: 'loc-1',
      customerName: 'Joao',
      customerPhone: '9999',
      items: [{ sku: '1', qty: 1 }],
      notes: 'sem cebola',
      deliveryType: 'delivery',
      deliveryAddress: { line1: 'Rua A' },
      context: {
        publicTokenId: 'pt-2',
        idempotencyKey: 'idem-1',
        marketingAttribution: {
          utm_source: 'google',
          utm_campaign: 'search brand',
          utm_term: 'crm brand',
          gclid: 'gclid-123',
          campaignId: 'cmp-1',
          keywordText: 'crm brand',
        },
      },
    });
    expect(createDeliveryForOrder).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      orderId: 'ord-1',
      deliveryAddress: { line1: 'Rua A' },
      context: {
        publicTokenId: 'pt-2',
        correlationId: 'corr-1',
        idempotencyKey: 'idem-1:delivery',
      },
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, {
      ok: true,
      order: { id: 'ord-1', context: { correlationId: 'corr-1' } },
      delivery: { id: 'del-1' },
    });
  });

  test('POST /storefront/orders repassa vertical somente quando informada', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-2', tenantId: 'tenant-1', locationId: null }));
    const createOrder = jest.fn(async () => ({ id: 'ord-9', context: {} }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/orderService', () => ({ createOrder }));
    const { handleStorefrontRoutes } = require('../../api/modules/platform-public/handleStorefrontRoutes');

    const res = { setHeader: jest.fn() };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        customerName: 'Maria',
        items: [{ name: 'Cesta', qty: 1, price: 59.9 }],
        deliveryType: 'pickup',
        vertical: 'market',
      })),
    });

    const req = makeReq({ url: '/storefront/orders?token=abc' });
    await handleStorefrontRoutes({ req, res, method: 'POST', pathname: '/storefront/orders', deps });

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ vertical: 'market' }));

    // sem vertical no body: parâmetro omitido (default do serviço prevalece)
    createOrder.mockClear();
    deps.parseJsonBody = jest.fn(async () => ({
      customerName: 'Maria',
      items: [{ name: 'Cesta', qty: 1, price: 59.9 }],
      deliveryType: 'pickup',
    }));
    await handleStorefrontRoutes({ req, res, method: 'POST', pathname: '/storefront/orders', deps });

    const callArgs = createOrder.mock.calls[0][0];
    expect(Object.prototype.hasOwnProperty.call(callArgs, 'vertical')).toBe(false);
  });

  test('POST /storefront/orders mapeia order_items_required para 400', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-2', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const createOrder = jest.fn(async () => {
      const err = new Error('items required');
      err.code = 'order_items_required';
      throw err;
    });

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/orderService', () => ({ createOrder }));
    jest.doMock('../../api/services/deliveryService', () => ({ createDeliveryForOrder: jest.fn() }));
    const { handleStorefrontRoutes } = require('../../api/modules/platform-public/handleStorefrontRoutes');

    const req = makeReq({ url: '/storefront/orders?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ items: [] })) });

    const handled = await handleStorefrontRoutes({ req, res, method: 'POST', pathname: '/storefront/orders', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 400, {
      error: 'bad_request',
      message: 'Itens do pedido são obrigatórios',
    });
  });

  test('GET /storefront/orders/:id retorna 404 quando pedido nao existe', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-3', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const getOrderById = jest.fn(async () => null);

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/orderService', () => ({ getOrderById }));
    jest.doMock('../../api/services/deliveryService', () => ({ getDeliveryByOrderId: jest.fn() }));
    const { handleStorefrontRoutes } = require('../../api/modules/platform-public/handleStorefrontRoutes');

    const req = makeReq({ url: '/storefront/orders/ord-404?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps();

    const handled = await handleStorefrontRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/storefront/orders/ord-404',
      deps,
    });

    expect(handled).toBe(true);
    expect(getOrderById).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'ord-404' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'order_not_found',
      message: 'Pedido não encontrado',
    });
  });

  test('GET /storefront/orders/:id retorna status com delivery', async () => {
    const resolvePublicToken = jest.fn(async () => ({ ok: true, tokenId: 'pt-3', tenantId: 'tenant-1', locationId: 'loc-1' }));
    const getOrderById = jest.fn(async () => ({ id: 'ord-2', status: 'new' }));
    const getDeliveryByOrderId = jest.fn(async () => ({ id: 'del-2', status: 'queued' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/orderService', () => ({ getOrderById }));
    jest.doMock('../../api/services/deliveryService', () => ({ getDeliveryByOrderId }));
    const { handleStorefrontRoutes } = require('../../api/modules/platform-public/handleStorefrontRoutes');

    const req = makeReq({ url: '/storefront/orders/ord%202?token=abc' });
    const res = { setHeader: jest.fn() };
    const deps = makeDeps();

    const handled = await handleStorefrontRoutes({
      req,
      res,
      method: 'GET',
      pathname: '/storefront/orders/ord%202',
      deps,
    });

    expect(handled).toBe(true);
    expect(getOrderById).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'ord 2' });
    expect(getDeliveryByOrderId).toHaveBeenCalledWith({ tenantId: 'tenant-1', orderId: 'ord 2' });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      order: { id: 'ord-2', status: 'new' },
      delivery: { id: 'del-2', status: 'queued' },
    });
  });
});
