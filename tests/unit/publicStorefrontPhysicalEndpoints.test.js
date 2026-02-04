/**
 * Smoke tests para endpoints públicos (Delivery v1 / Filas físicas v1)
 *
 * Importante: estes testes sobem um `createServer()` com mocks de DB/migrations
 * para evitar inicialização pesada.
 */

const http = require('http');

jest.setTimeout(30000);

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function httpJson({ port, path, method, headers }, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...(headers || {}) } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data || '{}') });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('endpoints públicos /storefront e /physical', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  test('POST /storefront/orders exige token', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const r = await httpJson({
      port,
      method: 'POST',
      path: '/storefront/orders',
    }, { items: [{ qty: 1, name: 'Pizza' }] });

    expect(r.status).toBe(401);

    await new Promise((resolve) => server.close(resolve));
  });

  test('POST /storefront/orders cria pedido com token válido', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    const resolvePublicToken = jest.fn(async () => ({ ok: true, tenantId: 'tenant-1', locationId: 'loja-1', tokenId: 'pat-1' }));
    const createOrder = jest.fn(async ({ tenantId }) => ({ id: 'ord-1', tenant_key: tenantId, status: 'created' }));
    const createDeliveryForOrder = jest.fn(async () => ({ id: 'del-1', status: 'pending' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/orderService', () => ({ createOrder }));
    jest.doMock('../../api/services/deliveryService', () => ({ createDeliveryForOrder }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const r = await httpJson({
      port,
      method: 'POST',
      path: '/storefront/orders?token=pub_123',
    }, { items: [{ qty: 1, name: 'Pizza' }] });

    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, order: { id: 'ord-1' }, delivery: { id: 'del-1' } });
    expect(resolvePublicToken).toHaveBeenCalled();
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1' }));
    expect(createDeliveryForOrder).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', orderId: 'ord-1' }));

    await new Promise((resolve) => server.close(resolve));
  });

  test('POST /physical/kiosk/tickets cria ticket com token válido', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    const resolvePublicToken = jest.fn(async () => ({ ok: true, tenantId: 'tenant-1', locationId: 'loja-1', tokenId: 'pat-1' }));
    const createTicket = jest.fn(async () => ({ id: 'pt-1', ticket_number: '001', status: 'waiting' }));

    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));
    jest.doMock('../../api/services/physicalQueueService', () => ({ createTicket }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const r = await httpJson({
      port,
      method: 'POST',
      path: '/physical/kiosk/tickets?token=pub_123',
    }, {});

    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, ticket: { id: 'pt-1', ticket_number: '001' } });
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', locationId: 'loja-1' }));

    await new Promise((resolve) => server.close(resolve));
  });

  test('GET /public-tokens/resolve retorna meta do token público', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      connect: jest.fn(async () => ({})),
      getSequelize: jest.fn(() => ({})),
      close: jest.fn(async () => {}),
      Sequelize: require('sequelize').Sequelize,
    }));
    jest.doMock('../../api/db/migrate', () => ({ runMigrations: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/seed', () => ({ runSeed: jest.fn(async () => {}) }));
    jest.doMock('../../api/db/models', () => ({ defineRelationships: jest.fn() }));

    const resolvePublicToken = jest.fn(async () => ({
      ok: true,
      tenantId: 'tenant-1',
      locationId: 'loja-1',
      tokenId: 'pat-1',
      kind: 'kiosk',
      meta: { biometricMode: 'verify-1to1' },
    }));
    jest.doMock('../../api/services/publicAccessTokenService', () => ({ resolvePublicToken }));

    // eslint-disable-next-line global-require
    const { createServer } = require('../../api/server');
    const server = createServer();
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    const r = await httpJson({
      port,
      method: 'GET',
      path: '/public-tokens/resolve?token=pub_123',
    });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      token: {
        id: 'pat-1',
        kind: 'kiosk',
        tenantId: 'tenant-1',
        locationId: 'loja-1',
        meta: { biometricMode: 'verify-1to1' },
      },
    });

    await new Promise((resolve) => server.close(resolve));
  });
});

