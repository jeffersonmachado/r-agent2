function ensureTicketPermission(req, res, deps, action) {
  const { requireAuth, requirePermission, sendJson } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = requirePermission(req, 'tickets', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

async function handleOrderRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    createTicket,
    getTicket,
    logger,
  } = deps;

  if (method === 'GET' && pathname === '/orders') {
    if (!ensureTicketPermission(req, res, { requireAuth, requirePermission, sendJson }, 'read')) {
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const status = urlObj.searchParams.get('status');
      const limit = urlObj.searchParams.get('limit') || '50';
      const offset = urlObj.searchParams.get('offset') || '0';
      const { listOrders } = require('../../services/orderService');
      const result = await listOrders({ tenantId: req.tenantId, status, limit, offset });
      sendJson(res, 200, { ok: true, orders: result.items, total: result.total });
    } catch (err) {
      logger.error('[Orders] Erro ao listar pedidos:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar pedidos' });
    }

    return true;
  }

  if (method === 'GET' && pathname.startsWith('/orders/')) {
    if (!ensureTicketPermission(req, res, { requireAuth, requirePermission, sendJson }, 'read')) {
      return true;
    }

    try {
      const orderId = decodeURIComponent(pathname.slice('/orders/'.length));
      const { getOrderById } = require('../../services/orderService');
      const order = await getOrderById({ tenantId: req.tenantId, orderId });
      if (!order) {
        sendJson(res, 404, { error: 'order_not_found', message: 'Pedido não encontrado' });
        return true;
      }
      const { getDeliveryByOrderId } = require('../../services/deliveryService');
      const delivery = await getDeliveryByOrderId({ tenantId: req.tenantId, orderId });
      sendJson(res, 200, { ok: true, order, delivery });
    } catch (err) {
      logger.error('[Orders] Erro ao obter pedido:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter pedido' });
    }

    return true;
  }

  if (method === 'GET' && pathname.startsWith('/deliveries/')) {
    if (!ensureTicketPermission(req, res, { requireAuth, requirePermission, sendJson }, 'read')) {
      return true;
    }

    try {
      const deliveryId = decodeURIComponent(pathname.slice('/deliveries/'.length));
      const { Delivery } = require('../../db/models');
      const DeliveryModel = Delivery();
      const row = await DeliveryModel.findOne({ where: { tenant_key: req.tenantId, id: String(deliveryId) } });
      if (!row) {
        sendJson(res, 404, { error: 'delivery_not_found', message: 'Delivery não encontrado' });
        return true;
      }
      sendJson(res, 200, { ok: true, delivery: row.toJSON ? row.toJSON() : row });
    } catch (err) {
      logger.error('[Delivery] Erro ao obter delivery:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter delivery' });
    }

    return true;
  }

  if (method === 'PUT' && pathname.match(/^\/deliveries\/[^\/]+\/status$/)) {
    if (!ensureTicketPermission(req, res, { requireAuth, requirePermission, sendJson }, 'update')) {
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const deliveryId = decodeURIComponent(pathname.split('/')[2]);
      const body = await parseJsonBody(req);
      const status = body && body.status ? String(body.status).trim() : '';
      const { updateDeliveryStatus } = require('../../services/deliveryService');
      const delivery = await updateDeliveryStatus({ tenantId: req.tenantId, deliveryId, status });
      sendJson(res, 200, { ok: true, delivery });
    } catch (err) {
      const code = err && err.code ? String(err.code) : null;
      if (code === 'delivery_not_found') {
        sendJson(res, 404, { error: 'delivery_not_found', message: 'Delivery não encontrado' });
        return true;
      }
      logger.error('[Delivery] Erro ao atualizar status:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar status do delivery' });
    }

    return true;
  }

  if (method === 'PUT' && pathname.match(/^\/orders\/[^\/]+\/status$/)) {
    if (!ensureTicketPermission(req, res, { requireAuth, requirePermission, sendJson }, 'update')) {
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const orderId = decodeURIComponent(pathname.split('/')[2]);
      const body = await parseJsonBody(req);
      const status = body && body.status ? String(body.status).trim() : '';
      const { updateOrderStatus } = require('../../services/orderService');
      const order = await updateOrderStatus({ tenantId: req.tenantId, orderId, status });
      try {
        if (status === 'dispatched' || status === 'delivered' || status === 'cancelled') {
          const { getDeliveryByOrderId, updateDeliveryStatus } = require('../../services/deliveryService');
          const delivery = await getDeliveryByOrderId({ tenantId: req.tenantId, orderId });
          if (delivery && delivery.id) {
            await updateDeliveryStatus({
              tenantId: req.tenantId,
              deliveryId: delivery.id,
              status: status === 'cancelled' ? 'cancelled' : status,
            }).catch(() => {});
          }
        }
      } catch (_) {}
      sendJson(res, 200, { ok: true, order });
    } catch (err) {
      const code = err && err.code ? String(err.code) : null;
      if (code === 'order_not_found') {
        sendJson(res, 404, { error: 'order_not_found', message: 'Pedido não encontrado' });
        return true;
      }
      if (code === 'invalid_order_status_transition') {
        sendJson(res, 400, { error: 'invalid_transition', message: 'Transição de status inválida', details: err.details });
        return true;
      }
      logger.error('[Orders] Erro ao atualizar status:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar status do pedido' });
    }

    return true;
  }

  if (method === 'POST' && pathname.match(/^\/orders\/[^\/]+\/incidents$/)) {
    if (!ensureTicketPermission(req, res, { requireAuth, requirePermission, sendJson }, 'update')) {
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const orderId = decodeURIComponent(pathname.split('/')[2]);
      const { getOrderById } = require('../../services/orderService');
      const order = await getOrderById({ tenantId: req.tenantId, orderId });
      if (!order) {
        sendJson(res, 404, { error: 'order_not_found', message: 'Pedido não encontrado' });
        return true;
      }

      const body = await parseJsonBody(req);
      const queue = body && body.queue ? String(body.queue).trim() : 'Delivery';
      const incidentType = body && body.type ? String(body.type).trim() : 'generic';
      const message = body && body.message ? String(body.message).trim() : `Incidente (${incidentType}) no pedido ${order.order_number}`;
      const idempotencyKey = body && body.idempotencyKey ? String(body.idempotencyKey).trim() : null;

      try {
        const { getOrderIncident } = require('../../services/orderService');
        const existingIncident = await getOrderIncident({ tenantId: req.tenantId, orderId: order.id });
        const existingTicketId = existingIncident?.ticketId || null;
        const existingStatus = existingIncident?.status || null;
        if (existingTicketId && existingStatus !== 'closed') {
          let existingTicket = null;
          try {
            existingTicket = getTicket(existingTicketId) || null;
          } catch (_) {}
          sendJson(res, 200, { ok: true, idempotent: true, ticketId: existingTicketId, ticket: existingTicket || { id: existingTicketId } });
          return true;
        }
      } catch (_) {}

      const sessionId = `order_${order.id}`;
      const ticket = createTicket({
        tenantId: req.tenantId,
        sessionId,
        queue,
        lastUserMessage: message,
        context: {
          escalationReason: 'order_incident',
          metadata: {
            kind: 'order_incident',
            orderId: order.id,
            orderNumber: order.order_number,
            incidentType,
            correlationId: order?.context?.correlationId || null,
            idempotencyKey: idempotencyKey || null,
          },
        },
        tags: ['delivery', 'incident'],
      });

      try {
        const { setOrderIncident } = require('../../services/orderService');
        await setOrderIncident({
          tenantId: req.tenantId,
          orderId: order.id,
          incident: {
            ticketId: ticket.id,
            type: incidentType,
            queue,
            status: 'open',
            message,
            idempotencyKey: idempotencyKey || null,
            createdAt: new Date().toISOString(),
            actorUserId: req.agent?.id || null,
          },
        });
      } catch (_) {}

      try {
        const { appendEventV1 } = require('../../services/eventLedgerService');
        await appendEventV1({
          tenantId: req.tenantId,
          type: 'SupportIncidentOpened',
          source: 'orders.ops',
          occurredAt: new Date(),
          correlationId: order?.context?.correlationId || null,
          subject: { type: 'order', id: order.id },
          actor: { type: 'user', id: String(req.agent?.id || 'unknown') },
          idempotencyKey: `incident:${req.tenantId}:${order.id}:${incidentType}:${idempotencyKey || ticket.id}`,
          payload: {
            ticketId: ticket.id,
            orderId: order.id,
            incidentType,
            queue,
          },
        });
      } catch (_) {}

      sendJson(res, 201, { ok: true, ticket });
    } catch (err) {
      logger.error('[Orders] Erro ao abrir incidente:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao abrir incidente' });
    }

    return true;
  }

  return false;
}

module.exports = {
  handleOrderRoutes,
};
