'use strict';

const express = require('express');

function ensureConfigPermission(req, res, deps, action) {
  const authResult = deps.requireAuth(req);
  if (!authResult.valid) {
    deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = deps.requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

function createWhatsAppConnectionRoutes({ buildDeps }) {
  const router = express.Router();

  router.get('/whatsapp/connections', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureConfigPermission(req, res, deps, 'read')) return;
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return;

    try {
      const service = require('../../services/whatsappQrService');
      const out = await service.listConnections(tenantId);
      if (!out.ok) {
        deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return;
      }
      deps.sendJson(res, 200, { ok: true, connections: out.connections || [] });
    } catch (err) {
      deps.logger.error('[WhatsAppQR] Erro ao listar conexões:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar conexões' });
    }
  });

  router.post('/whatsapp/connections', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureConfigPermission(req, res, deps, 'update')) return;
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const service = require('../../services/whatsappQrService');
      const out = await service.createConnection(tenantId, body || {});
      if (!out.ok) {
        deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return;
      }
      deps.sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      deps.logger.error('[WhatsAppQR] Erro ao criar conexão:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar conexão' });
    }
  });

  async function handleConnectionAction(req, res, action) {
    const deps = buildDeps(req, res);
    if (!ensureConfigPermission(req, res, deps, 'update')) return;
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return;

    if ((action === 'status' || action === 'events') && !deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const service = require('../../services/whatsappQrService');
      const id = decodeURIComponent(req.params.connectionId);

      if (action === 'qr') {
        const out = await service.generateQr(tenantId, id);
        if (!out.ok) {
          if (out.error === 'not_found') {
            deps.sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
            return;
          }
          deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
          return;
        }
        deps.sendJson(res, 200, { ok: true, connection: out.connection, qr: out.qr });
        return;
      }

      if (action === 'disconnect') {
        const out = await service.disconnectConnection(tenantId, id);
        if (!out.ok) {
          if (out.error === 'not_found') {
            deps.sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
            return;
          }
          deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
          return;
        }
        deps.sendJson(res, 200, { ok: true, connection: out.connection });
        return;
      }

      if (action === 'status') {
        const body = await deps.parseJsonBody(req);
        const out = await service.setConnectionStatus(tenantId, id, body || {});
        if (!out.ok) {
          if (out.error === 'not_found') {
            deps.sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
            return;
          }
          if (out.error === 'invalid_status') {
            deps.sendJson(res, 400, { error: 'invalid_status', message: 'Status inválido. Use connected|pairing|disconnected|error' });
            return;
          }
          deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
          return;
        }
        deps.sendJson(res, 200, { ok: true, connection: out.connection });
        return;
      }

      const body = await deps.parseJsonBody(req);
      const out = await service.ingestConnectionEvent(tenantId, id, body || {});
      if (!out.ok) {
        if (out.error === 'not_found') {
          deps.sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return;
        }
        if (out.error === 'event_type_required') {
          deps.sendJson(res, 400, { error: 'event_type_required', message: 'eventType é obrigatório' });
          return;
        }
        if (out.error === 'invalid_event_type') {
          deps.sendJson(res, 400, { error: 'invalid_event_type', message: 'eventType inválido. Use qr|pairing|connected|ready|disconnected|logout|closed|error|failed' });
          return;
        }
        deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return;
      }
      deps.sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      deps.logger.error(`[WhatsAppQR] Erro ao executar ação ${action}:`, err);
      deps.sendJson(res, 500, { error: 'internal_error', message: `Erro ao executar ação ${action}` });
    }
  }

  router.post('/whatsapp/connections/:connectionId/qr', (req, res) => handleConnectionAction(req, res, 'qr'));
  router.post('/whatsapp/connections/:connectionId/disconnect', (req, res) => handleConnectionAction(req, res, 'disconnect'));
  router.post('/whatsapp/connections/:connectionId/status', (req, res) => handleConnectionAction(req, res, 'status'));
  router.post('/whatsapp/connections/:connectionId/events', (req, res) => handleConnectionAction(req, res, 'events'));

  router.get('/whatsapp/connections/:connectionId/status', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureConfigPermission(req, res, deps, 'read')) return;
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return;

    try {
      const service = require('../../services/whatsappQrService');
      const id = decodeURIComponent(req.params.connectionId);
      const out = await service.getStatus(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          deps.sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return;
        }
        deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return;
      }
      deps.sendJson(res, 200, out);
    } catch (err) {
      deps.logger.error('[WhatsAppQR] Erro ao obter status:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter status' });
    }
  });

  return router;
}

module.exports = {
  createWhatsAppConnectionRoutes,
};
