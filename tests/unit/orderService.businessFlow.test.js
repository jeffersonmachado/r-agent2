'use strict';

/**
 * Testes do fluxo de negócio de pedidos no orderService:
 * - total calculado a partir dos itens (pedido sem total não pode gerar cobrança);
 * - resolução do cliente (customerId) e evento de jornada order_placed;
 * - vínculo e confirmação idempotente de pagamento (webhook de billing).
 */

describe('orderService business flow', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadService({ create, findOne, ensureOrderCustomer, emitJourneyEvent, appendEventV1 } = {}) {
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({
        create: create || jest.fn(async (payload) => ({ toJSON: () => payload })),
        findOne: findOne || jest.fn(async () => null),
      }),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: appendEventV1 || jest.fn(async () => ({ ok: true })),
    }));
    jest.doMock('../../api/services/orderCustomerService', () => ({
      ensureOrderCustomer: ensureOrderCustomer || jest.fn(async () => null),
      resolveCustomerId: jest.fn(),
      normalizePhone: jest.fn(),
    }));
    jest.doMock('../../api/services/vertical/customerJourneyEngine', () => ({
      emitJourneyEvent: emitJourneyEvent || jest.fn(async () => ({ ok: true })),
    }));
    // eslint-disable-next-line global-require
    return require('../../api/services/orderService');
  }

  describe('total do pedido', () => {
    test('sem totalAmount, soma price*qty dos itens', async () => {
      const create = jest.fn(async (payload) => ({ toJSON: () => payload }));
      const { createOrder } = loadService({ create });

      const order = await createOrder({
        tenantId: 'tenant-1',
        items: [
          { name: 'Pizza', qty: 2, price: 35.5 },
          { name: 'Refri', qty: 1, price: 8 },
        ],
      });

      expect(order.total_amount).toBe(79);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ total_amount: 79 }));
    });

    test('totalAmount informado prevalece sobre a soma dos itens', async () => {
      const create = jest.fn(async (payload) => ({ toJSON: () => payload }));
      const { createOrder } = loadService({ create });

      const order = await createOrder({
        tenantId: 'tenant-1',
        items: [{ name: 'Pizza', qty: 1, price: 35.5 }],
        totalAmount: 30,
      });

      expect(order.total_amount).toBe(30);
    });

    test('itens sem preço e sem totalAmount resultam em total null', async () => {
      const create = jest.fn(async (payload) => ({ toJSON: () => payload }));
      const { createOrder } = loadService({ create });

      const order = await createOrder({
        tenantId: 'tenant-1',
        items: [{ name: 'Pizza', qty: 1 }],
      });

      expect(order.total_amount).toBeNull();
    });
  });

  describe('cliente e jornada', () => {
    test('pedido com telefone resolve cliente e emite order_placed', async () => {
      const create = jest.fn(async (payload) => ({ toJSON: () => payload }));
      const ensureOrderCustomer = jest.fn(async () => ({ customerId: 'cust-abc', subjectId: 'acs-abc' }));
      const emitJourneyEvent = jest.fn(async () => ({ ok: true }));
      const { createOrder } = loadService({ create, ensureOrderCustomer, emitJourneyEvent });

      const order = await createOrder({
        tenantId: 'tenant-1',
        vertical: 'food',
        customerName: 'Maria',
        customerPhone: '+5511999000111',
        items: [{ name: 'Pizza', qty: 1, price: 40 }],
      });

      expect(ensureOrderCustomer).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'tenant-1',
        vertical: 'food',
        customerPhone: '+5511999000111',
      }));
      expect(order.context.customerId).toBe('cust-abc');
      expect(order.context.customerSubjectId).toBe('acs-abc');
      expect(order.context.vertical).toBe('food');
      expect(emitJourneyEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'order_placed',
        subjectId: 'acs-abc',
        customerId: 'cust-abc',
        payload: expect.objectContaining({ orderId: order.id }),
      }));
    });

    test('pedido sem telefone não resolve cliente nem emite order_placed', async () => {
      const create = jest.fn(async (payload) => ({ toJSON: () => payload }));
      const ensureOrderCustomer = jest.fn(async () => ({ customerId: 'cust-x', subjectId: 'acs-x' }));
      const emitJourneyEvent = jest.fn(async () => ({ ok: true }));
      const { createOrder } = loadService({ create, ensureOrderCustomer, emitJourneyEvent });

      const order = await createOrder({
        tenantId: 'tenant-1',
        items: [{ name: 'Pizza', qty: 1, price: 40 }],
      });

      expect(ensureOrderCustomer).not.toHaveBeenCalled();
      expect(emitJourneyEvent).not.toHaveBeenCalled();
      expect(order.context.customerId).toBeUndefined();
    });

    test('falha no evento de jornada não derruba a criação do pedido', async () => {
      const create = jest.fn(async (payload) => ({ toJSON: () => payload }));
      const ensureOrderCustomer = jest.fn(async () => ({ customerId: 'cust-abc', subjectId: 'acs-abc' }));
      const emitJourneyEvent = jest.fn(async () => { throw new Error('journey_db_down'); });
      const { createOrder } = loadService({ create, ensureOrderCustomer, emitJourneyEvent });

      const order = await createOrder({
        tenantId: 'tenant-1',
        customerPhone: '+5511999000111',
        items: [{ name: 'Pizza', qty: 1, price: 40 }],
      });

      expect(order.status).toBe('created');
      expect(order.context.customerId).toBe('cust-abc');
    });
  });

  describe('pagamento do pedido', () => {
    function makeRow(payment) {
      return {
        context: { payment },
        update: jest.fn(async function update(fields) { this.context = fields.context; }),
        toJSON() { return { id: 'ord-1', tenant_key: 'tenant-1', context: this.context }; },
      };
    }

    test('markOrderPaymentStatus confirmed grava paidAt e emite OrderPaymentConfirmed', async () => {
      const row = makeRow({ transactionId: 'bt-1', status: 'pending', amount: 79 });
      const findOne = jest.fn(async () => row);
      const appendEventV1 = jest.fn(async () => ({ ok: true }));
      const { markOrderPaymentStatus } = loadService({ findOne, appendEventV1 });

      const out = await markOrderPaymentStatus({
        tenantId: 'tenant-1', orderId: 'ord-1', status: 'paid', transactionId: 'bt-1', amount: 79,
      });

      expect(out.idempotent).toBe(false);
      expect(row.context.payment.status).toBe('paid');
      expect(row.context.payment.paidAt).toBeTruthy();
      expect(appendEventV1).toHaveBeenCalledWith(expect.objectContaining({
        type: 'OrderPaymentConfirmed',
        idempotencyKey: 'order_payment_confirmed:tenant-1:ord-1:bt-1',
      }));
    });

    test('mesmo status repetido é idempotente e não emite evento duplicado', async () => {
      const row = makeRow({ transactionId: 'bt-1', status: 'paid', amount: 79, paidAt: '2026-07-26T00:00:00Z' });
      const findOne = jest.fn(async () => row);
      const appendEventV1 = jest.fn(async () => ({ ok: true }));
      const { markOrderPaymentStatus } = loadService({ findOne, appendEventV1 });

      const out = await markOrderPaymentStatus({
        tenantId: 'tenant-1', orderId: 'ord-1', status: 'paid', transactionId: 'bt-1',
      });

      expect(out.idempotent).toBe(true);
      expect(row.update).not.toHaveBeenCalled();
      expect(appendEventV1).not.toHaveBeenCalled();
    });

    test('pedido sem pagamento vinculado lança order_payment_not_found', async () => {
      const findOne = jest.fn(async () => makeRow(null));
      const { markOrderPaymentStatus } = loadService({ findOne });

      await expect(markOrderPaymentStatus({ tenantId: 'tenant-1', orderId: 'ord-1', status: 'paid' }))
        .rejects.toMatchObject({ code: 'order_payment_not_found' });
    });
  });
});
