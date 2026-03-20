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
