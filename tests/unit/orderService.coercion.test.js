'use strict';

describe('orderService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createOrder tolera item hostil e ainda filtra corretamente', async () => {
    const create = jest.fn(async (payload) => ({ toJSON: () => payload }));
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({ create }),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const { createOrder } = require('../../api/services/orderService');
    const hostile = { toString() { throw new Error('boom-item'); } };

    const order = await createOrder({
      tenantId: hostile,
      items: [
        { qty: 1, name: hostile, notes: hostile },
        { qty: 2, name: 'Pizza' },
      ],
      context: {
        correlationId: hostile,
        idempotencyKey: hostile,
        publicTokenId: hostile,
      },
    });

    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ name: 'Pizza', qty: 2 });
    expect(typeof order.order_number).toBe('string');
  });

  test('updateOrderStatus com status hostil falha no contrato sem quebrar', async () => {
    const row = {
      id: 'ord-1',
      tenant_key: 'tenant-1',
      status: 'created',
      update: jest.fn(async () => {}),
      previous: jest.fn(() => 'created'),
      toJSON: () => ({ id: 'ord-1', status: 'created', updated_at: new Date().toISOString() }),
    };
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({ findOne: jest.fn(async () => row) }),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const { updateOrderStatus } = require('../../api/services/orderService');
    const hostile = { toString() { throw new Error('boom-status'); } };

    await expect(updateOrderStatus({ tenantId: 'tenant-1', orderId: 'ord-1', status: hostile }))
      .rejects
      .toMatchObject({ code: 'invalid_order_status_transition' });
  });

  test('listOrders tolera status hostil', async () => {
    const findAndCountAll = jest.fn(async () => ({ rows: [], count: 0 }));
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({ findAndCountAll }),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const { listOrders } = require('../../api/services/orderService');
    const hostile = { toString() { throw new Error('boom-list-status'); } };

    const out = await listOrders({ tenantId: 'tenant-1', status: hostile, limit: 10, offset: 0 });
    expect(out).toEqual({ items: [], total: 0 });
  });

  test('getOrderMetrics tolera locationId hostil', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([[{}]])
      .mockResolvedValueOnce([[]]);
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({ sequelize: { query } }),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const { getOrderMetrics } = require('../../api/services/orderService');
    const hostile = { toString() { throw new Error('boom-location'); } };

    const out = await getOrderMetrics({ tenantId: 'tenant-1', locationId: hostile });
    expect(out).toEqual(expect.objectContaining({ ok: true }));
    expect(query).toHaveBeenCalledTimes(2);
  });
});
