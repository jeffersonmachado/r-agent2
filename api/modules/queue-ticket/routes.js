'use strict';

const express = require('express');

function createQueueTicketRoutes({ buildDeps }) {
  const router = express.Router();

  router.get('/api/physical/queues', async (req, res) => {
    const deps = buildDeps(req, res);
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = deps.requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const locationId = urlObj.searchParams.get('locationId');
      const status = urlObj.searchParams.get('status');
      const { listQueues } = require('../../services/physicalQueueService');
      const items = await listQueues({
        tenantId: req.tenantId,
        locationId: locationId ? String(locationId) : null,
        status: status ? String(status) : null,
      });
      deps.sendJson(res, 200, { ok: true, items });
    } catch (err) {
      deps.logger.error('[PhysicalAdmin] Erro ao listar filas físicas:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar filas físicas' });
    }
  });

  router.post('/api/physical/queues', async (req, res) => {
    const deps = buildDeps(req, res);
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = deps.requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const id = body && body.id ? String(body.id).trim() : null;
      const locationId = body && body.locationId ? String(body.locationId).trim() : null;
      const name = body && body.name ? String(body.name).trim() : '';
      const status = body && body.status ? String(body.status).trim() : 'active';
      const rules = body && typeof body.rules === 'object' && body.rules ? body.rules : {};
      const { upsertQueue } = require('../../services/physicalQueueService');
      const item = await upsertQueue({
        tenantId: req.tenantId,
        id,
        locationId,
        name,
        status,
        rules,
      });
      deps.sendJson(res, 200, { ok: true, item });
    } catch (err) {
      if (String(err && err.code || '') === 'physical_queue_name_required') {
        deps.sendJson(res, 400, { error: 'bad_request', message: 'Nome da fila é obrigatório' });
        return;
      }
      deps.logger.error('[PhysicalAdmin] Erro ao salvar fila física:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar fila física' });
    }
  });

  router.get('/api/physical/metrics', async (req, res) => {
    const deps = buildDeps(req, res);
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = deps.requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const locationId = urlObj.searchParams.get('locationId');
      const { getMetrics } = require('../../services/physicalQueueService');
      const metrics = await getMetrics({
        tenantId: req.tenantId,
        locationId: locationId ? String(locationId) : null,
      });
      deps.sendJson(res, 200, metrics);
    } catch (err) {
      deps.logger.error('[PhysicalAdmin] Erro ao obter métricas físicas:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas físicas' });
    }
  });

  router.get('/api/physical/tickets', async (req, res) => {
    const deps = buildDeps(req, res);
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = deps.requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const locationId = urlObj.searchParams.get('locationId');
      const queueId = urlObj.searchParams.get('queueId');
      const status = urlObj.searchParams.get('status');
      const stationId = urlObj.searchParams.get('stationId');
      const limit = urlObj.searchParams.get('limit');
      const offset = urlObj.searchParams.get('offset');
      const { listTickets } = require('../../services/physicalQueueService');
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
        deps.sendJson(res, 503, { error: 'service_unavailable', message: result.reason || 'physical_tickets_unavailable' });
        return;
      }
      deps.sendJson(res, 200, result);
    } catch (err) {
      deps.logger.error('[PhysicalAdmin] Erro ao listar tickets físicos:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar tickets físicos' });
    }
  });

  router.get('/api/orders/metrics', async (req, res) => {
    const deps = buildDeps(req, res);
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }
    const permResult = deps.requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const locationId = urlObj.searchParams.get('locationId');
      const { getOrderMetrics } = require('../../services/orderService');
      const metrics = await getOrderMetrics({
        tenantId: req.tenantId,
        locationId: locationId ? String(locationId) : null,
      });
      deps.sendJson(res, 200, metrics);
    } catch (err) {
      deps.logger.error('[OrdersAdmin] Erro ao obter métricas de pedidos:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas de pedidos' });
    }
  });

  return router;
}

module.exports = {
  createQueueTicketRoutes,
};
