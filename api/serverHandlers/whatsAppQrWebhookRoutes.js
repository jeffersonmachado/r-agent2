function ensurePermission(req, res, deps, resource, action) {
  const { requireAuth, requirePermission, sendJson } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const permResult = requirePermission(req, resource, action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }
  return true;
}

async function handleWhatsAppQrWebhookRoutes(ctx) {
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

  if (method === 'POST' && pathname === '/webhooks/whatsapp-qr/events') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const secretExpected = String(process.env.WHATSAPP_QR_WEBHOOK_SECRET || '').trim();
      if (secretExpected) {
        const provided = String(req.headers['x-whatsapp-qr-secret'] || '').trim();
        if (!provided || provided !== secretExpected) {
          sendJson(res, 401, { error: 'unauthorized', message: 'Invalid webhook secret' });
          return true;
        }
      }
      const tenantId = body?.tenantId || body?.tenant_id;
      const connectionId = body?.connectionId || body?.connection_id;
      if (!tenantId || !connectionId) {
        sendJson(res, 400, { error: 'invalid_payload', message: 'tenantId e connectionId são obrigatórios' });
        return true;
      }
      const service = require('../services/whatsappQrService');
      const out = await service.ingestConnectionEvent(String(tenantId), String(connectionId), body || {});
      if (!out.ok) {
        if (out.error === 'not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return true;
        }
        if (out.error === 'event_type_required' || out.error === 'invalid_event_type') {
          sendJson(res, 400, { error: out.error, message: 'eventType inválido ou ausente' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      logger.error('[WhatsAppQR] Erro no webhook de eventos:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao processar webhook de evento' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/whatsapp/qr-bridge/stats') {
    if (!ensurePermission(req, res, { requireAuth, requirePermission, sendJson }, 'reports', 'read')) {
      return true;
    }
    try {
      const { getWhatsAppQrBridgeStats } = require('../services/whatsappQrBridgeService');
      sendJson(res, 200, { ok: true, ...getWhatsAppQrBridgeStats() });
    } catch (err) {
      logger.error('[WhatsAppQRBridge] Erro ao obter stats:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter stats do bridge' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleWhatsAppQrWebhookRoutes,
};
