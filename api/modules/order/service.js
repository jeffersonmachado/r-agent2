'use strict';

function parseStatusBody(body) {
  return {
    status: body && body.status ? String(body.status).trim() : '',
  };
}

function parseIncidentBody(body, order) {
  const incidentType = body && body.type ? String(body.type).trim() : 'generic';

  return {
    queue: body && body.queue ? String(body.queue).trim() : 'Delivery',
    incidentType,
    message: body && body.message ? String(body.message).trim() : `Incidente (${incidentType}) no pedido ${order.order_number}`,
    idempotencyKey: body && body.idempotencyKey ? String(body.idempotencyKey).trim() : null,
  };
}

function parseListOrders(urlString) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  return {
    status: urlObj.searchParams.get('status'),
    limit: urlObj.searchParams.get('limit') || '50',
    offset: urlObj.searchParams.get('offset') || '0',
  };
}

function createOrderService({ orderService, deliveryService, dbModels, eventLedgerService }) {
  return {
    parseStatusBody,
    parseIncidentBody,

    listOrders({ tenantId, url }) {
      return orderService.listOrders({ tenantId, ...parseListOrders(url) });
    },

    getOrderById({ tenantId, orderId }) {
      return orderService.getOrderById({ tenantId, orderId });
    },

    getDeliveryByOrderId({ tenantId, orderId }) {
      return deliveryService.getDeliveryByOrderId({ tenantId, orderId });
    },

    async getDeliveryById({ tenantId, deliveryId }) {
      const DeliveryModel = dbModels.Delivery();
      const row = await DeliveryModel.findOne({ where: { tenant_key: tenantId, id: String(deliveryId) } });
      if (!row) {
        return null;
      }

      return row.toJSON ? row.toJSON() : row;
    },

    updateDeliveryStatus({ tenantId, deliveryId, status }) {
      return deliveryService.updateDeliveryStatus({ tenantId, deliveryId, status });
    },

    updateOrderStatus({ tenantId, orderId, status }) {
      return orderService.updateOrderStatus({ tenantId, orderId, status });
    },

    async syncDeliveryStatusForOrder({ tenantId, orderId, status }) {
      if (!(status === 'dispatched' || status === 'delivered' || status === 'cancelled')) {
        return;
      }

      const delivery = await deliveryService.getDeliveryByOrderId({ tenantId, orderId });
      if (delivery && delivery.id) {
        await deliveryService.updateDeliveryStatus({
          tenantId,
          deliveryId: delivery.id,
          status: status === 'cancelled' ? 'cancelled' : status,
        }).catch(() => {});
      }
    },

    getOrderIncident({ tenantId, orderId }) {
      return orderService.getOrderIncident({ tenantId, orderId });
    },

    async createOrderCharge({ tenantId, orderId, amount, currency = 'BRL', provider = 'sandbox', idempotencyKey = null }) {
      const order = await orderService.getOrderById({ tenantId, orderId });
      if (!order) {
        const err = new Error('order_not_found');
        err.code = 'order_not_found';
        throw err;
      }

      // Idempotência de negócio: pedido já possui cobrança vinculada e não
      // liquidada — retorna a mesma transação em vez de duplicar.
      const existingPayment = order.context && typeof order.context === 'object' ? order.context.payment : null;
      if (existingPayment && existingPayment.transactionId && ['pending', 'paid'].includes(existingPayment.status)) {
        const billingService = require('../../services/billingService');
        const found = await billingService.findTransactionById({
          tenantId,
          transactionId: existingPayment.transactionId,
        });
        if (found) {
          return { idempotent: true, transaction: found, payment: existingPayment };
        }
      }

      const chargeAmount = amount != null ? Number(amount) : Number(order.total_amount);
      if (!Number.isFinite(chargeAmount) || chargeAmount <= 0) {
        const err = new Error('amount must be > 0');
        err.code = 'validation_error';
        throw err;
      }

      const billingService = require('../../services/billingService');
      const charge = await billingService.createCharge({
        tenantId,
        vertical: (order.context && order.context.vertical) || 'food',
        type: 'one_time',
        amount: chargeAmount,
        currency,
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        provider,
        description: `Pedido ${order.order_number}`,
        customerName: order.customer_name || null,
        customerPhone: order.customer_phone || null,
        customerId: (order.context && order.context.customerId) || null,
        subjectId: (order.context && order.context.customerSubjectId) || null,
        idempotencyKey: idempotencyKey || `order_charge:${tenantId}:${orderId}:${chargeAmount}`,
        metadata: {
          orderId: order.id,
          orderNumber: order.order_number,
          source: 'order_charge',
          // vertical real do pedido (billing.vertical é restrito a fitness/beauty)
          businessVertical: (order.context && order.context.vertical) || null,
        },
      });

      const payment = {
        transactionId: charge.transaction.id,
        status: 'pending',
        method: 'online',
        amount: chargeAmount,
        currency,
        provider,
        createdAt: new Date().toISOString(),
      };
      await orderService.setOrderPayment({ tenantId, orderId: order.id, payment });

      return { idempotent: Boolean(charge.idempotent), transaction: charge.transaction, payment };
    },

    setOrderIncident({ tenantId, orderId, incident }) {
      return orderService.setOrderIncident({ tenantId, orderId, incident });
    },

    appendEvent(payload) {
      return eventLedgerService.appendEventV1(payload);
    },
  };
}

module.exports = {
  createOrderService,
};
