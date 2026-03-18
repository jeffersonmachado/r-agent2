'use strict';

describe('deliveryService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function buildMocks({ existingById = null, updatedAt = '2026-03-18T10:00:00.000Z' } = {}) {
    const findOne = jest.fn(async ({ where }) => {
      if (where && where.order_id) return null;
      if (where && where.id && existingById) {
        return {
          toJSON: () => existingById,
        };
      }
      return {
        toJSON: () => ({
          id: 'del-1',
          tenant_key: 'tenant-1',
          order_id: 'ord-1',
          status: 'pending',
          context: {},
          updated_at: updatedAt,
        }),
        update: jest.fn(async () => {}),
      };
    });

    const create = jest.fn(async ({ id, tenant_key, order_id, status, context }) => ({
      toJSON: () => ({
        id,
        tenant_key,
        order_id,
        status,
        context,
        updated_at: updatedAt,
      }),
    }));

    const sequelize = {
      query: jest.fn(async () => [[{ id: 'del-existing' }]]),
    };

    jest.doMock('../../api/db/models', () => ({
      Delivery: jest.fn(() => ({
        sequelize,
        findOne,
        create,
      })),
    }));

    const appendEventV1 = jest.fn(async () => ({ ok: true }));
    jest.doMock('../../api/services/eventLedgerService', () => ({ appendEventV1 }));

    return { findOne, create, appendEventV1, sequelize };
  }

  test('createDeliveryForOrder tolera idempotencyKey hostil sem excecao', async () => {
    buildMocks();
    const { createDeliveryForOrder } = require('../../api/services/deliveryService');
    const hostile = { toString() { throw new Error('boom-idk'); } };

    const out = await createDeliveryForOrder({
      tenantId: 'tenant-1',
      orderId: 'ord-1',
      context: { idempotencyKey: hostile },
    });

    expect(out).toEqual(expect.objectContaining({
      id: expect.any(String),
      tenant_key: 'tenant-1',
      order_id: 'ord-1',
      status: 'pending',
    }));
  });

  test('createDeliveryForOrder tolera correlationId/publicTokenId hostis', async () => {
    const { appendEventV1 } = buildMocks();
    const { createDeliveryForOrder } = require('../../api/services/deliveryService');
    const hostile = { toString() { throw new Error('boom-ctx'); } };

    await expect(createDeliveryForOrder({
      tenantId: 'tenant-1',
      orderId: 'ord-1',
      context: {
        correlationId: hostile,
        publicTokenId: hostile,
        idempotencyKey: hostile,
      },
    })).resolves.toEqual(expect.objectContaining({ order_id: 'ord-1' }));

    expect(appendEventV1).toHaveBeenCalled();
  });

  test('updateDeliveryStatus tolera status e updated_at hostis', async () => {
    const hostileStatus = { toString() { throw new Error('boom-status'); } };
    const hostileUpdatedAt = { toString() { throw new Error('boom-updated-at'); } };

    const rowJson = {
      id: 'del-1',
      tenant_key: 'tenant-1',
      order_id: 'ord-1',
      status: 'pending',
      context: {},
      updated_at: hostileUpdatedAt,
    };

    const findOne = jest.fn(async () => ({
      update: jest.fn(async () => {}),
      toJSON: () => rowJson,
    }));

    const create = jest.fn();
    const sequelize = { query: jest.fn(async () => [[]]) };

    const appendEventV1 = jest.fn(async () => ({ ok: true }));
    jest.doMock('../../api/db/models', () => ({
      Delivery: jest.fn(() => ({ sequelize, findOne, create })),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({ appendEventV1 }));

    const { updateDeliveryStatus } = require('../../api/services/deliveryService');

    const out = await updateDeliveryStatus({
      tenantId: 'tenant-1',
      deliveryId: 'del-1',
      status: hostileStatus,
    });

    expect(out).toEqual(rowJson);
    expect(appendEventV1).toHaveBeenCalled();
  });
});
