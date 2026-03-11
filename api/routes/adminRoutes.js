'use strict';

async function handleAdminRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      isSuperAdmin,
      sendJson,
      parseJsonBody,
      logger,
      requireTenant,
      clearLimitersCache,
      clearRedisRateLimitKeys,
      config,
      listAllTenants,
      getTenantMetrics,
      blockTenant,
      unblockTenant,
      adjustTenantPlan,
      badRequest,
    },
  } = context;

  if (method === 'POST' && pathname === '/admin/rate-limit/clear-cache') {
    try {
      clearLimitersCache();
      logger.info('[Admin] Cache de rate limiters limpo via endpoint');
      sendJson(res, 200, {
        success: true,
        message: 'Cache de rate limiters limpo com sucesso',
      });
    } catch (err) {
      logger.error('[Admin] Erro ao limpar cache de rate limiters:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao limpar cache',
      });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/admin/rate-limit/clear') {
    const nodeEnv = config.get('nodeEnv', 'development');
    if (nodeEnv !== 'development') {
      sendJson(res, 403, {
        error: 'forbidden',
        message: 'Este endpoint está disponível apenas em desenvolvimento',
      });
      return true;
    }

    try {
      const deletedCount = await clearRedisRateLimitKeys();
      logger.info('[Admin] Rate limit do Redis limpo via endpoint', { deletedCount });
      sendJson(res, 200, {
        success: true,
        message: `Rate limit limpo com sucesso. ${deletedCount} chave(s) removida(s).`,
        deletedCount,
      });
    } catch (err) {
      logger.error('[Admin] Erro ao limpar rate limit do Redis:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao limpar rate limit',
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/super-admin/tenants') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar esta área' });
      return true;
    }

    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {
        status: url.searchParams.get('status'),
        plan: url.searchParams.get('plan'),
        search: url.searchParams.get('search'),
      };

      const tenants = await listAllTenants(filters);
      sendJson(res, 200, { tenants });
    } catch (err) {
      logger.error('Erro ao listar tenants (Super Admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/api/admin/tenant/') && pathname.endsWith('/alerts')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar o OCC' });
      return true;
    }
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const tenantId = decodeURIComponent(pathname.slice('/api/admin/tenant/'.length).replace('/alerts', ''));
      const schedulingHealthService = require('../services/schedulingHealthService');
      const out = await schedulingHealthService.listAlerts({
        tenantId,
        includeResolved: url.searchParams.get('includeResolved') === 'true',
        limit: Number(url.searchParams.get('limit') || 100),
      });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('Erro ao listar alertas OCC:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/api/admin/tenant/') && pathname.endsWith('/ura/audit')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar o OCC' });
      return true;
    }
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const tenantId = decodeURIComponent(pathname.slice('/api/admin/tenant/'.length).replace('/ura/audit', ''));
      const uraDecisionAuditService = require('../services/uraDecisionAuditService');
      const out = await uraDecisionAuditService.listRecentAudits({
        tenantId,
        limit: Number(url.searchParams.get('limit') || 50),
      });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('Erro ao listar auditoria URA OCC:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/api/admin/tenant/') && pathname.endsWith('/feature-flags')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar feature flags do OCC' });
      return true;
    }
    try {
      const tenantId = decodeURIComponent(pathname.slice('/api/admin/tenant/'.length).replace('/feature-flags', ''));
      const tenantFeatureService = require('../services/tenantFeatureService');
      const out = await tenantFeatureService.listFlags({ tenantId });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('Erro ao listar feature flags OCC:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/api/tenant/feature-flags/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const featureKey = decodeURIComponent(pathname.slice('/api/tenant/feature-flags/'.length)).trim();
      if (!featureKey) {
        sendJson(res, 400, { error: 'bad_request', message: 'featureKey é obrigatório' });
        return true;
      }
      const tenantFeatureService = require('../services/tenantFeatureService');
      const out = await tenantFeatureService.getFlag({ tenantId, featureKey });
      sendJson(res, 200, {
        ok: true,
        item: out?.item || {
          id: null,
          tenantId,
          featureKey,
          enabled: false,
          config: {},
          createdAt: null,
          updatedAt: null,
        },
      });
    } catch (err) {
      logger.error('Erro ao ler feature flag do tenant autenticado:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'PUT' && pathname.startsWith('/api/admin/tenant/') && pathname.includes('/feature-flags/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode alterar feature flags do OCC' });
      return true;
    }
    try {
      const body = await parseJsonBody(req).catch(() => ({}));
      const afterPrefix = pathname.slice('/api/admin/tenant/'.length);
      const [encodedTenantId, encodedFeatureKey] = afterPrefix.split('/feature-flags/');
      const tenantId = decodeURIComponent(encodedTenantId || '');
      const featureKey = decodeURIComponent(encodedFeatureKey || '');
      const tenantFeatureService = require('../services/tenantFeatureService');
      const out = await tenantFeatureService.upsertFlag({
        tenantId,
        featureKey,
        enabled: body?.enabled === true,
        config: body?.config_json || body?.config || {},
      });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('Erro ao atualizar feature flag OCC:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname.includes('/metrics') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar esta área' });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/metrics', ''));
    const metrics = await getTenantMetrics(tenantId);
    if (!metrics) {
      sendJson(res, 404, { error: 'tenant_not_found' });
      return true;
    }

    sendJson(res, 200, { metrics });
    return true;
  }

  if (method === 'POST' && pathname.includes('/block') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode bloquear tenants' });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/block', ''));

    try {
      const body = await parseJsonBody(req);
      const reason = body.reason || 'Bloqueado por Super Admin';

      const result = blockTenant(tenantId, reason, req.agent.id);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return true;
      }

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao bloquear tenant:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname.includes('/unblock') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode desbloquear tenants' });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/unblock', ''));

    const result = unblockTenant(tenantId, req.agent.id);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return true;
    }

    sendJson(res, 200, { tenant: result.tenant });
    return true;
  }

  if (method === 'POST' && pathname.includes('/adjust-plan') && pathname.startsWith('/super-admin/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode ajustar planos' });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/super-admin/tenants/'.length).replace('/adjust-plan', ''));

    try {
      const body = await parseJsonBody(req);
      if (!body.plan) {
        badRequest(res, 'Campo "plan" é obrigatório');
        return true;
      }

      const result = adjustTenantPlan(tenantId, body.plan, body.customLimits, req.agent.id);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return true;
      }

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao ajustar plano:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  return false;
}

module.exports = {
  handleAdminRoutes,
};
