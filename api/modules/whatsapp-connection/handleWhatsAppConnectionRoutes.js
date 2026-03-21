'use strict';

function ensureConfigPermission(req, res, deps, action) {
  const { requireAuth, requirePermission, sendJson } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

function parseConnectionId(pathname, suffix) {
  return decodeURIComponent(pathname.slice('/whatsapp/connections/'.length, -suffix.length));
}

async function handleWhatsAppConnectionRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (method === 'GET' && pathname === '/whatsapp/connections') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const service = require('../../services/whatsappQrService');
      const out = await service.listConnections(tenantId);
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connections: out.connections || [] });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao listar conexões:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar conexões' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/connections') {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const service = require('../../services/whatsappQrService');
      const out = await service.createConnection(tenantId, body || {});
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao criar conexão:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar conexão' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/qr')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const id = parseConnectionId(pathname, '/qr');
      const service = require('../../services/whatsappQrService');
      const out = await service.generateQr(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection, qr: out.qr });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao gerar QR:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao gerar QR' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/disconnect')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const id = parseConnectionId(pathname, '/disconnect');
      const service = require('../../services/whatsappQrService');
      const out = await service.disconnectConnection(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao desconectar:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao desconectar' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/status')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const id = parseConnectionId(pathname, '/status');
      const body = await parseJsonBody(req);
      const service = require('../../services/whatsappQrService');
      const out = await service.setConnectionStatus(tenantId, id, body || {});
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        if (out.error === 'invalid_status') {
          sendJson(res, 400, { error: 'invalid_status', message: 'Status inválido. Use connected|pairing|disconnected|error' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao atualizar status:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar status' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/events')) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const id = parseConnectionId(pathname, '/events');
      const body = await parseJsonBody(req);
      const service = require('../../services/whatsappQrService');
      const out = await service.ingestConnectionEvent(tenantId, id, body || {});
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        if (out.error === 'event_type_required') {
          sendJson(res, 400, { error: 'event_type_required', message: 'eventType é obrigatório' });
          return true;
        }
        if (out.error === 'invalid_event_type') {
          sendJson(res, 400, { error: 'invalid_event_type', message: 'eventType inválido. Use qr|pairing|connected|ready|disconnected|logout|closed|error|failed' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao ingerir evento de conexão:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao ingerir evento de conexão' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/whatsapp/connections/') && pathname.endsWith('/status')) {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const id = parseConnectionId(pathname, '/status');
      const service = require('../../services/whatsappQrService');
      const out = await service.getStatus(tenantId, id);
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[WhatsAppQR] Erro ao obter status:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter status' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleWhatsAppConnectionRoutes,
};
