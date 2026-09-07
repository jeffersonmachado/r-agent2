'use strict';

const express = require('express');

/**
 * Push Routes (Web Push / PWA).
 *
 * GET  /api/push/public-key  – chave pública VAPID (503 quando não configurado)
 * POST /api/push/subscribe   – inscreve dispositivo do usuário autenticado
 * POST /api/push/unsubscribe – remove inscrição pelo endpoint
 */
function createPushRoutes({ buildDeps }) {
  const router = express.Router();

  function requireTenantAuth(req, res, deps) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return null;
    }
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return null;
    return tenantId;
  }

  function userId(req) {
    return req.agent?.id || req.user?.id || req.agent?.email || req.user?.email || 'unknown';
  }

  router.get('/api/push/public-key', (req, res) => {
    const deps = buildDeps(req, res);
    const key = deps.pushNotificationService.publicKey();
    if (!key) {
      deps.sendJson(res, 503, { error: 'webpush_not_configured', message: 'Web Push não configurado neste ambiente.' });
      return;
    }
    deps.sendJson(res, 200, { publicKey: key });
  });

  router.post('/api/push/subscribe', async (req, res, next) => {
    try {
      const deps = buildDeps(req, res);
      const tenantId = requireTenantAuth(req, res, deps);
      if (!tenantId) return;
      if (!deps.hasJsonContentType(req)) { deps.badRequest(res, 'Content-Type deve ser application/json'); return; }
      const body = await deps.parseJsonBody(req);
      const item = await deps.pushNotificationService.subscribe({
        tenantId,
        userId: userId(req),
        subscription: body?.subscription,
        deviceName: body?.deviceName || null,
        userAgent: req.headers['user-agent'] || null,
      });
      deps.sendJson(res, 201, { item: { id: item.id, endpoint: item.endpoint, deviceName: item.device_name } });
    } catch (err) {
      if (String(err?.code) === 'validation_error') {
        const deps = buildDeps(req, res);
        deps.badRequest(res, err.message);
        return;
      }
      next(err);
    }
  });

  router.post('/api/push/unsubscribe', async (req, res, next) => {
    try {
      const deps = buildDeps(req, res);
      const tenantId = requireTenantAuth(req, res, deps);
      if (!tenantId) return;
      if (!deps.hasJsonContentType(req)) { deps.badRequest(res, 'Content-Type deve ser application/json'); return; }
      const body = await deps.parseJsonBody(req);
      const endpoint = body?.endpoint || body?.subscription?.endpoint;
      if (!endpoint) { deps.badRequest(res, 'endpoint required'); return; }
      const result = await deps.pushNotificationService.unsubscribe({ tenantId, endpoint });
      deps.sendJson(res, 200, result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPushRoutes };
