/**
 * Queue and Ticket Route Handler
 * Handles: Physical queues, tickets, and order metrics
 */

async function handleQueueTicketRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  // -----------------------------------------------------------------------
  // Filas físicas (Admin / autenticado)
  // -----------------------------------------------------------------------
  // GET /api/physical/queues?locationId=...&status=...
  if (method === 'GET' && pathname === '/api/physical/queues') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const locationId = urlObj.searchParams.get('locationId');
      const status = urlObj.searchParams.get('status');
      const { listQueues } = require('../services/physicalQueueService');
      const items = await listQueues({
        tenantId: req.tenantId,
        locationId: locationId ? String(locationId) : null,
        status: status ? String(status) : null,
      });
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[PhysicalAdmin] Erro ao listar filas físicas:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar filas físicas' });
    }
    return true;
  }

  // POST /api/physical/queues - cria/atualiza fila física
  if (method === 'POST' && pathname === '/api/physical/queues') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const id = body && body.id ? String(body.id).trim() : null;
      const locationId = body && body.locationId ? String(body.locationId).trim() : null;
      const name = body && body.name ? String(body.name).trim() : '';
      const status = body && body.status ? String(body.status).trim() : 'active';
      const rules = body && typeof body.rules === 'object' && body.rules ? body.rules : {};
      const { upsertQueue } = require('../services/physicalQueueService');
      const item = await upsertQueue({
        tenantId: req.tenantId,
        id,
        locationId,
        name,
        status,
        rules,
      });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err && err.code ? String(err.code) : null;
      if (code === 'physical_queue_name_required') {
        sendJson(res, 400, { error: 'bad_request', message: 'Nome da fila é obrigatório' });
        return true;
      }
      logger.error('[PhysicalAdmin] Erro ao salvar fila física:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar fila física' });
    }
    return true;
  }

  // GET /api/physical/metrics?locationId=...
  if (method === 'GET' && pathname === '/api/physical/metrics') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const locationId = urlObj.searchParams.get('locationId');
      const { getMetrics } = require('../services/physicalQueueService');
      const metrics = await getMetrics({
        tenantId: req.tenantId,
        locationId: locationId ? String(locationId) : null,
      });
      sendJson(res, 200, metrics);
    } catch (err) {
      logger.error('[PhysicalAdmin] Erro ao obter métricas físicas:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas físicas' });
    }
    return true;
  }

  // GET /api/physical/tickets?locationId=&queueId=&status=&stationId=&limit=&offset=
  if (method === 'GET' && pathname === '/api/physical/tickets') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const locationId = urlObj.searchParams.get('locationId');
      const queueId = urlObj.searchParams.get('queueId');
      const status = urlObj.searchParams.get('status');
      const stationId = urlObj.searchParams.get('stationId');
      const limit = urlObj.searchParams.get('limit');
      const offset = urlObj.searchParams.get('offset');
      const { listTickets } = require('../services/physicalQueueService');
      const result = await listTickets({
        tenantId: req.tenantId,
        locationId: locationId ? String(locationId) : null,
        queueId: queueId ? String(queueId) : null,
        status: status ? String(status) : null,
        stationId: stationId ? String(stationId) : null,
        limit: limit != null ? Number(limit) : 100,
        offset: offset != null ? Number(offset) : 0,
      });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.reason || 'physical_tickets_unavailable' });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('[PhysicalAdmin] Erro ao listar tickets físicos:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar tickets físicos' });
    }
    return true;
  }

  // GET /api/orders/metrics?locationId=...
  if (method === 'GET' && pathname === '/api/orders/metrics') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const locationId = urlObj.searchParams.get('locationId');
      const { getOrderMetrics } = require('../services/orderService');
      const metrics = await getOrderMetrics({
        tenantId: req.tenantId,
        locationId: locationId ? String(locationId) : null,
      });
      sendJson(res, 200, metrics);
    } catch (err) {
      logger.error('[OrdersAdmin] Erro ao obter métricas de pedidos:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas de pedidos' });
    }
    return true;
  }

  // Not a queue/ticket route
  return false;
}

module.exports = { handleQueueTicketRoutes };
