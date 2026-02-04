/**
 * Testes unitários do OrderService (Delivery v1)
 */

describe('orderService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createOrder exige ao menos 1 item', async () => {
    const create = jest.fn();
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({ create }),
    }));

    // eslint-disable-next-line global-require
    const { createOrder } = require('../../api/services/orderService');

    await expect(createOrder({
      tenantId: 'tenant-1',
      items: [],
    })).rejects.toMatchObject({ code: 'order_items_required' });

    expect(create).not.toHaveBeenCalled();
  });

  test('createOrder normaliza itens e cria pedido', async () => {
    const create = jest.fn(async (payload) => ({
      toJSON: () => payload,
    }));
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({ create }),
    }));

    // eslint-disable-next-line global-require
    const { createOrder } = require('../../api/services/orderService');

    const order = await createOrder({
      tenantId: 'tenant-1',
      items: [
        { qty: '2', name: ' Pizza ' },
        { qty: 1, name: '' }, // deve ser filtrado
      ],
      deliveryAddress: { address: 'Rua X' },
    });

    expect(order.tenant_key).toBe('tenant-1');
    expect(order.status).toBe('created');
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ qty: 2, name: 'Pizza' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('updateOrderStatus valida transição e atualiza timestamps', async () => {
    const row = {
      id: 'ord-1',
      tenant_key: 'tenant-1',
      status: 'created',
      update: jest.fn(async (patch) => {
        row.status = patch.status;
        row.confirmed_at = patch.confirmed_at;
      }),
      toJSON: () => ({ id: row.id, status: row.status, confirmed_at: row.confirmed_at }),
    };

    const findOne = jest.fn(async () => row);
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({ findOne }),
    }));

    // eslint-disable-next-line global-require
    const { updateOrderStatus } = require('../../api/services/orderService');

    const updated = await updateOrderStatus({ tenantId: 'tenant-1', orderId: 'ord-1', status: 'confirmed' });
    expect(updated.status).toBe('confirmed');
    expect(updated.confirmed_at).toBeInstanceOf(Date);
    expect(row.update).toHaveBeenCalled();
  });

  test('updateOrderStatus rejeita transição inválida', async () => {
    const row = { id: 'ord-1', tenant_key: 'tenant-1', status: 'created', update: jest.fn() };
    const findOne = jest.fn(async () => row);
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({ findOne }),
    }));

    // eslint-disable-next-line global-require
    const { updateOrderStatus } = require('../../api/services/orderService');

    await expect(updateOrderStatus({ tenantId: 'tenant-1', orderId: 'ord-1', status: 'delivered' }))
      .rejects
      .toMatchObject({ code: 'invalid_order_status_transition' });
  });

  test('listOrders retorna items e total', async () => {
    const findAndCountAll = jest.fn(async () => ({
      rows: [
        { toJSON: () => ({ id: 'ord-1' }) },
        { toJSON: () => ({ id: 'ord-2' }) },
      ],
      count: 2,
    }));
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({ findAndCountAll }),
    }));

    // eslint-disable-next-line global-require
    const { listOrders } = require('../../api/services/orderService');

    const res = await listOrders({ tenantId: 'tenant-1', status: 'created', limit: 50, offset: 0 });
    expect(res.total).toBe(2);
    expect(res.items).toHaveLength(2);
    expect(findAndCountAll).toHaveBeenCalled();
  });
});

