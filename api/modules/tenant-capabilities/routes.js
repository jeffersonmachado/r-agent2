'use strict';

const express = require('express');
const {
  getTenantCapabilities,
  setTenantCapabilities,
} = require('../../services/tenantCapabilitiesService');
const {
  setTenantVertical,
  CANONICAL_VERTICAL_IDS,
} = require('../../services/onboardingService');

const CAPABILITY_MANAGER_ROLES = new Set(['owner', 'admin', 'super_admin']);

function resolveTenantKey(req) {
  const raw = req.tenantId || (req.agent && req.agent.tenantId) || null;
  const tenantKey = typeof raw === 'string' ? raw.trim() : '';
  return tenantKey || null;
}

function createTenantCapabilitiesRoutes({ buildDeps }) {
  const router = express.Router();

  function depsFor(req, res) {
    return buildDeps(req, res);
  }

  function ensureAuth(deps, req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    return true;
  }

  router.get('/api/tenant/capabilities', async (req, res) => {
    const deps = depsFor(req, res);
    if (!ensureAuth(deps, req, res)) return;

    const tenantKey = resolveTenantKey(req);
    if (!tenantKey) {
      deps.sendJson(res, 403, { error: 'tenant_required' });
      return;
    }

    try {
      const capabilities = await getTenantCapabilities(tenantKey);
      deps.sendJson(res, 200, { capabilities });
    } catch (err) {
      deps.logger.error('[TenantCapabilities] Erro ao ler capabilities', {
        tenantKey,
        error: err && err.message,
      });
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao ler capabilities do tenant' });
    }
  });

  router.put('/api/tenant/capabilities', async (req, res) => {
    const deps = depsFor(req, res);
    if (!ensureAuth(deps, req, res)) return;

    const role = req.agent && req.agent.role;
    if (!CAPABILITY_MANAGER_ROLES.has(role)) {
      deps.sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner/admin podem alterar capabilities do tenant' });
      return;
    }

    const tenantKey = resolveTenantKey(req);
    if (!tenantKey) {
      deps.sendJson(res, 403, { error: 'tenant_required' });
      return;
    }

    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    let body;
    try {
      body = await deps.parseJsonBody(req);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      throw err;
    }

    try {
      const result = await setTenantCapabilities(tenantKey, body || {});
      if (!result.ok) {
        const status = result.error === 'tenant_not_found' ? 404 : 400;
        deps.sendJson(res, status, { error: result.error, message: result.message });
        return;
      }
      deps.sendJson(res, 200, { capabilities: result.capabilities });
    } catch (err) {
      deps.logger.error('[TenantCapabilities] Erro ao atualizar capabilities', {
        tenantKey,
        error: err && err.message,
      });
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar capabilities do tenant' });
    }
  });

  router.put('/api/tenant/settings/vertical', async (req, res) => {
    const deps = depsFor(req, res);
    if (!ensureAuth(deps, req, res)) return;

    const role = req.agent && req.agent.role;
    if (!CAPABILITY_MANAGER_ROLES.has(role)) {
      deps.sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner/admin podem alterar a vertical do tenant' });
      return;
    }

    const tenantKey = resolveTenantKey(req);
    if (!tenantKey) {
      deps.sendJson(res, 403, { error: 'tenant_required' });
      return;
    }

    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    let body;
    try {
      body = await deps.parseJsonBody(req);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
        return;
      }
      throw err;
    }

    try {
      const result = await setTenantVertical(tenantKey, body && body.vertical);
      if (!result.success) {
        if (result.error === 'tenant_not_found') {
          deps.sendJson(res, 404, { error: result.error, message: 'tenant não encontrado' });
          return;
        }
        deps.sendJson(res, 400, {
          error: result.error,
          message: `vertical deve ser um de: ${CANONICAL_VERTICAL_IDS.join(', ')} (ou vazio para limpar)`,
        });
        return;
      }
      deps.sendJson(res, 200, { vertical: result.vertical });
    } catch (err) {
      deps.logger.error('[TenantCapabilities] Erro ao atualizar vertical do tenant', {
        tenantKey,
        error: err && err.message,
      });
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar vertical do tenant' });
    }
  });

  return router;
}

module.exports = {
  createTenantCapabilitiesRoutes,
};
