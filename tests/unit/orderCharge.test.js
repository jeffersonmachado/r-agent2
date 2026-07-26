'use strict';

/**
 * Testes da cobrança de pedido (POST /orders/:orderId/charge → createOrderCharge).
 *
 * Regra de negócio: um pedido pago começa com uma cobrança vinculada
 * (context.payment) registrada no billing com metadata.orderId — é esse
 * vínculo que permite ao webhook confirmar o pagamento no pedido.
 */

describe('order module createOrderCharge', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadModuleService({ order, charge, findTransactionById, setOrderPayment } = {}) {
    jest.doMock('../../api/services/billingService', () => ({
      createCharge: charge || jest.fn(),
      findTransactionById: findTransactionById || jest.fn(async () => null),
    }));
    // eslint-disable-next-line global-require
    const { createOrderService } = require('../../api/modules/order/service');
    return createOrderService({
      orderService: {
        getOrderById: jest.fn(async () => order || null),
        setOrderPayment: setOrderPayment || jest.fn(async () => ({})),
      },
      deliveryService: {},
      dbModels: {},
      eventLedgerService: {},
    });
  }

  const baseOrder = {
    id: 'ord-1',
    tenant_key: 'tenant-1',
    order_number: 'tenant-abc123',
    customer_name: 'Maria',
    customer_phone: '+5511999000111',
    total_amount: '79.00',
    context: { vertical: 'food', customerId: 'cust-1', customerSubjectId: 'acs-1' },
  };

  test('pedido inexistente lança order_not_found', async () => {
    const service = loadModuleService({ order: null });
    await expect(service.createOrderCharge({ tenantId: 'tenant-1', orderId: 'ord-404' }))
      .rejects.toMatchObject({ code: 'order_not_found' });
  });

  test('pedido sem total e sem amount lança validation_error', async () => {
    const service = loadModuleService({ order: { ...baseOrder, total_amount: null } });
    await expect(service.createOrderCharge({ tenantId: 'tenant-1', orderId: 'ord-1' }))
      .rejects.toMatchObject({ code: 'validation_error' });
  });

  test('cria cobrança com metadata.orderId e grava payment pending no pedido', async () => {
    const charge = jest.fn(async () => ({
      idempotent: false,
      transaction: { id: 'bt-1', status: 'pending', amount: '79.00' },
    }));
    const setOrderPayment = jest.fn(async () => ({}));
    const service = loadModuleService({ order: baseOrder, charge, setOrderPayment });

    const out = await service.createOrderCharge({ tenantId: 'tenant-1', orderId: 'ord-1' });

    expect(out.idempotent).toBe(false);
    expect(charge).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      amount: 79,
      currency: 'BRL',
      customerId: 'cust-1',
      subjectId: 'acs-1',
      metadata: expect.objectContaining({
        orderId: 'ord-1',
        orderNumber: 'tenant-abc123',
        source: 'order_charge',
        businessVertical: 'food',
      }),
    }));
    expect(setOrderPayment).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      orderId: 'ord-1',
      payment: expect.objectContaining({ transactionId: 'bt-1', status: 'pending', amount: 79 }),
    }));
  });

  test('pedido com cobrança pending retorna a mesma transação (idempotente)', async () => {
    const orderComPagamento = {
      ...baseOrder,
      context: { ...baseOrder.context, payment: { transactionId: 'bt-1', status: 'pending' } },
    };
    const charge = jest.fn();
    const findTransactionById = jest.fn(async () => ({ id: 'bt-1', status: 'pending' }));
    const service = loadModuleService({ order: orderComPagamento, charge, findTransactionById });

    const out = await service.createOrderCharge({ tenantId: 'tenant-1', orderId: 'ord-1' });

    expect(out.idempotent).toBe(true);
    expect(out.transaction.id).toBe('bt-1');
    expect(charge).not.toHaveBeenCalled();
  });

  test('pedido com payment em status terminal permite nova cobrança', async () => {
    const orderEstornado = {
      ...baseOrder,
      context: { ...baseOrder.context, payment: { transactionId: 'bt-0', status: 'refunded' } },
    };
    const charge = jest.fn(async () => ({
      idempotent: false,
      transaction: { id: 'bt-2', status: 'pending' },
    }));
    const service = loadModuleService({ order: orderEstornado, charge });

    const out = await service.createOrderCharge({ tenantId: 'tenant-1', orderId: 'ord-1' });

    expect(out.transaction.id).toBe('bt-2');
    expect(charge).toHaveBeenCalledTimes(1);
  });
});
