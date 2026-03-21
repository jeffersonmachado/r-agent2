function ensureReportsPermission(req, res, deps, action) {
  const { requireAuth, requirePermission, sendJson } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = requirePermission(req, 'reports', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

async function handleSlaRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (method === 'GET' && pathname === '/sla/policies') {
    if (!ensureReportsPermission(req, res, deps, 'read')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const service = require('../../services/slaService');
      const out = await service.listPolicies(tenantId);
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'sla_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, policies: out.policies || [] });
    } catch (err) {
      logger.error('[SLA] Erro ao listar policies:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar policies' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/sla/policies') {
    if (!ensureReportsPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const name = body && body.name ? String(body.name).trim() : '';
      if (!name) {
        badRequest(res, 'name é obrigatório');
        return true;
      }

      const service = require('../../services/slaService');
      const out = await service.upsertPolicy(tenantId, {
        id: body?.id || null,
        name,
        description: body?.description || '',
        customerSegment: body?.customerSegment || 'default',
        responseTimeMin: body?.responseTimeMin,
        resolutionTimeMin: body?.resolutionTimeMin,
        enabled: body?.enabled !== false,
      });
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'sla_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, policy: out.policy });
    } catch (err) {
      logger.error('[SLA] Erro ao salvar policy:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar policy' });
    }

    return true;
  }

  if (method === 'GET' && pathname === '/sla/breaches') {
    if (!ensureReportsPermission(req, res, deps, 'read')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const service = require('../../services/slaService');
      const out = await service.listBreaches(tenantId);
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'sla_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, breaches: out.breaches || [] });
    } catch (err) {
      logger.error('[SLA] Erro ao listar breaches:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar breaches' });
    }

    return true;
  }

  return false;
}

module.exports = {
  handleSlaRoutes,
};
