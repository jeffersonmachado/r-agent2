/**
 * Middleware: requireTenantCapability(capability)
 *
 * Bloqueia a rota com 403 { error: 'capability_disabled', capability } quando a
 * capability está desabilitada para o tenant do request.
 *
 * - requireAuth é aplicado antes (idempotente via short-circuit de token em
 *   api/middleware/auth.js); o tenant é resolvido de req.tenantId/req.agent.tenantId
 *   (mesmo padrão de composition/shared/requireTenant.js).
 * - Falha de DB ao ler capabilities → 500 explícito (sem fallback).
 */

'use strict';

const { requireAuth } = require('./auth');
const { sendJson } = require('../express/httpHelpers');
const logger = require('../utils/logger');
const { getTenantCapabilities } = require('../services/tenantCapabilitiesService');

function resolveTenantKey(req) {
  const raw = req.tenantId || (req.agent && req.agent.tenantId) || null;
  const tenantKey = typeof raw === 'string' ? raw.trim() : '';
  return tenantKey || null;
}

function requireTenantCapability(capability) {
  return async function tenantCapabilityMiddleware(req, res, next) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const tenantKey = resolveTenantKey(req);
    if (!tenantKey) {
      sendJson(res, 403, { error: 'tenant_required' });
      return;
    }

    try {
      const capabilities = await getTenantCapabilities(tenantKey);
      if (capabilities[capability] === false) {
        sendJson(res, 403, { error: 'capability_disabled', capability });
        return;
      }
      next();
    } catch (err) {
      logger.error('[requireTenantCapability] Falha ao ler capabilities do tenant', {
        tenantKey,
        capability,
        error: err && err.message,
      });
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao verificar capabilities do tenant' });
    }
  };
}

module.exports = {
  requireTenantCapability,
};
