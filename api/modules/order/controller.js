'use strict';

function createOrderController({ service, deps }) {
  function ensureTicketPermission(req, res, action) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }

    const permResult = deps.requirePermission(req, 'tickets', action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }

    return true;
  }

  return {
    async list(req, res) {
      if (!ensureTicketPermission(req, res, 'read')) return;
      try {
        const result = await service.listOrders({ tenantId: req.tenantId, url: req.url });
        deps.sendJson(res, 200, { ok: true, orders: result.items, total: result.total });
      } catch (err) {
        deps.logger.error('[Orders] Erro ao listar pedidos:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar pedidos' });
      }
    },

    async getOrder(req, res) {
      if (!ensureTicketPermission(req, res, 'read')) return;
      try {
        const orderId = decodeURIComponent(String(req.params.orderId));
        const order = await service.getOrderById({ tenantId: req.tenantId, orderId });
        if (!order) {
          deps.sendJson(res, 404, { error: 'order_not_found', message: 'Pedido não encontrado' });
          return;
        }

        const delivery = await service.getDeliveryByOrderId({ tenantId: req.tenantId, orderId });
        deps.sendJson(res, 200, { ok: true, order, delivery });
      } catch (err) {
        deps.logger.error('[Orders] Erro ao obter pedido:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter pedido' });
      }
    },

    async getDelivery(req, res) {
      if (!ensureTicketPermission(req, res, 'read')) return;
      try {
        const delivery = await service.getDeliveryById({
          tenantId: req.tenantId,
          deliveryId: decodeURIComponent(String(req.params.deliveryId)),
        });
        if (!delivery) {
          deps.sendJson(res, 404, { error: 'delivery_not_found', message: 'Delivery não encontrado' });
          return;
        }

        deps.sendJson(res, 200, { ok: true, delivery });
      } catch (err) {
        deps.logger.error('[Delivery] Erro ao obter delivery:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter delivery' });
      }
    },

    async updateDeliveryStatus(req, res) {
      if (!ensureTicketPermission(req, res, 'update')) return;
      if (!deps.hasJsonContentType(req)) {
        deps.badRequest(res, 'Content-Type deve ser application/json');
        return;
      }
      try {
        const { status } = service.parseStatusBody(await deps.parseJsonBody(req));
        const delivery = await service.updateDeliveryStatus({
          tenantId: req.tenantId,
          deliveryId: decodeURIComponent(String(req.params.deliveryId)),
          status,
        });
        deps.sendJson(res, 200, { ok: true, delivery });
      } catch (err) {
        const code = err && err.code ? String(err.code) : null;
        if (code === 'delivery_not_found') {
          deps.sendJson(res, 404, { error: 'delivery_not_found', message: 'Delivery não encontrado' });
          return;
        }
        deps.logger.error('[Delivery] Erro ao atualizar status:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar status do delivery' });
      }
    },

    async updateOrderStatus(req, res) {
      if (!ensureTicketPermission(req, res, 'update')) return;
      if (!deps.hasJsonContentType(req)) {
        deps.badRequest(res, 'Content-Type deve ser application/json');
        return;
      }
      try {
        const { status } = service.parseStatusBody(await deps.parseJsonBody(req));
        const orderId = decodeURIComponent(String(req.params.orderId));
        const order = await service.updateOrderStatus({ tenantId: req.tenantId, orderId, status });
        await service.syncDeliveryStatusForOrder({ tenantId: req.tenantId, orderId, status });
        deps.sendJson(res, 200, { ok: true, order });
      } catch (err) {
        const code = err && err.code ? String(err.code) : null;
        if (code === 'order_not_found') {
          deps.sendJson(res, 404, { error: 'order_not_found', message: 'Pedido não encontrado' });
          return;
        }
        if (code === 'invalid_order_status_transition') {
          deps.sendJson(res, 400, { error: 'invalid_transition', message: 'Transição de status inválida', details: err.details });
          return;
        }
        deps.logger.error('[Orders] Erro ao atualizar status:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar status do pedido' });
      }
    },

    async createIncident(req, res) {
      if (!ensureTicketPermission(req, res, 'update')) return;
      if (!deps.hasJsonContentType(req)) {
        deps.badRequest(res, 'Content-Type deve ser application/json');
        return;
      }

      try {
        const orderId = decodeURIComponent(String(req.params.orderId));
        const order = await service.getOrderById({ tenantId: req.tenantId, orderId });
        if (!order) {
          deps.sendJson(res, 404, { error: 'order_not_found', message: 'Pedido não encontrado' });
          return;
        }

        try {
          const existingIncident = await service.getOrderIncident({ tenantId: req.tenantId, orderId: order.id });
          const existingTicketId = existingIncident?.ticketId || null;
          const existingStatus = existingIncident?.status || null;
          if (existingTicketId && existingStatus !== 'closed') {
            let existingTicket = null;
            try {
              existingTicket = deps.getTicket(existingTicketId) || null;
            } catch (_) {}
            deps.sendJson(res, 200, {
              ok: true,
              idempotent: true,
              ticketId: existingTicketId,
              ticket: existingTicket || { id: existingTicketId },
            });
            return;
          }
        } catch (_) {}

        const payload = service.parseIncidentBody(await deps.parseJsonBody(req), order);
        const ticket = deps.createTicket({
          tenantId: req.tenantId,
          sessionId: `order_${order.id}`,
          queue: payload.queue,
          lastUserMessage: payload.message,
          context: {
            escalationReason: 'order_incident',
            metadata: {
              kind: 'order_incident',
              orderId: order.id,
              orderNumber: order.order_number,
              incidentType: payload.incidentType,
              correlationId: order?.context?.correlationId || null,
              idempotencyKey: payload.idempotencyKey || null,
            },
          },
          tags: ['delivery', 'incident'],
        });

        try {
          await service.setOrderIncident({
            tenantId: req.tenantId,
            orderId: order.id,
            incident: {
              ticketId: ticket.id,
              type: payload.incidentType,
              queue: payload.queue,
              status: 'open',
              message: payload.message,
              idempotencyKey: payload.idempotencyKey || null,
              createdAt: new Date().toISOString(),
              actorUserId: req.agent?.id || null,
            },
          });
        } catch (_) {}

        try {
          await service.appendEvent({
            tenantId: req.tenantId,
            type: 'SupportIncidentOpened',
            source: 'orders.ops',
            occurredAt: new Date(),
            correlationId: order?.context?.correlationId || null,
            subject: { type: 'order', id: order.id },
            actor: { type: 'user', id: String(req.agent?.id || 'unknown') },
            idempotencyKey: `incident:${req.tenantId}:${order.id}:${payload.incidentType}:${payload.idempotencyKey || ticket.id}`,
            payload: {
              ticketId: ticket.id,
              orderId: order.id,
              incidentType: payload.incidentType,
              queue: payload.queue,
            },
          });
        } catch (_) {}

        deps.sendJson(res, 201, { ok: true, ticket });
      } catch (err) {
        deps.logger.error('[Orders] Erro ao abrir incidente:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao abrir incidente' });
      }
    },
  };
}

module.exports = {
  createOrderController,
};
