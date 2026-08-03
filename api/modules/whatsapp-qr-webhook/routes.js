'use strict';

const crypto = require('crypto');
const express = require('express');

function ensurePermission(req, res, deps, resource, action) {
  const authResult = deps.requireAuth(req);
  if (!authResult.valid) {
    deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const permResult = deps.requirePermission(req, resource, action);
  if (!permResult.allowed) {
    deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }
  return true;
}

function createWhatsAppQrWebhookRoutes({ buildDeps }) {
  const router = express.Router();

  router.post('/webhooks/whatsapp-qr/events', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const secretExpected = String(process.env.WHATSAPP_QR_WEBHOOK_SECRET || '').trim();
      if (secretExpected) {
        const provided = String(req.headers['x-whatsapp-qr-secret'] || '').trim();
        const providedBuf = Buffer.from(provided, 'utf8');
        const expectedBuf = Buffer.from(secretExpected, 'utf8');
        const secretOk = provided
          && providedBuf.length === expectedBuf.length
          && crypto.timingSafeEqual(providedBuf, expectedBuf);
        if (!secretOk) {
          deps.sendJson(res, 401, { error: 'unauthorized', message: 'Invalid webhook secret' });
          return;
        }
      } else if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
        deps.logger.error('[WhatsAppQR] WHATSAPP_QR_WEBHOOK_SECRET não configurado em produção; webhook rejeitado (fail-closed)');
        deps.sendJson(res, 503, { error: 'webhook_misconfigured' });
        return;
      } else {
        deps.logger.warn('[WhatsAppQR] WHATSAPP_QR_WEBHOOK_SECRET não configurado; processando webhook SEM autenticação (fora de produção)');
      }

      const tenantId = body?.tenantId || body?.tenant_id;
      const connectionId = body?.connectionId || body?.connection_id;
      if (!tenantId || !connectionId) {
        deps.sendJson(res, 400, { error: 'invalid_payload', message: 'tenantId e connectionId são obrigatórios' });
        return;
      }

      const service = require('../../services/whatsappQrService');
      const out = await service.ingestConnectionEvent(String(tenantId), String(connectionId), body || {});
      if (!out.ok) {
        if (out.error === 'not_found') {
          deps.sendJson(res, 404, { error: 'not_found', message: 'Conexão não encontrada' });
          return;
        }
        if (out.error === 'event_type_required' || out.error === 'invalid_event_type') {
          deps.sendJson(res, 400, { error: out.error, message: 'eventType inválido ou ausente' });
          return;
        }
        deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return;
      }

      deps.sendJson(res, 200, { ok: true, connection: out.connection });
    } catch (err) {
      deps.logger.error('[WhatsAppQR] Erro no webhook de eventos:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao processar webhook de evento' });
    }
  });

  router.get('/api/whatsapp/qr-bridge/stats', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensurePermission(req, res, deps, 'reports', 'read')) return;

    try {
      const { getWhatsAppQrBridgeStats } = require('../../services/whatsappQrBridgeService');
      deps.sendJson(res, 200, { ok: true, ...getWhatsAppQrBridgeStats() });
    } catch (err) {
      deps.logger.error('[WhatsAppQRBridge] Erro ao obter stats:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter stats do bridge' });
    }
  });

  return router;
}

module.exports = {
  createWhatsAppQrWebhookRoutes,
};
