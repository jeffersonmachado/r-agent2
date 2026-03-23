'use strict';

async function handleIntelligenceGoalRoutes(ctx) {
  const { req, res, method, pathname, deps, service, tenantId } = ctx;
  const {
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (method === 'GET' && pathname === '/api/intelligence/goals') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const status = urlObj.searchParams.get('status');
      const limit = urlObj.searchParams.get('limit');
      const out = await service.listGoals({
        tenantId,
        status: status || null,
        includeComputed: true,
        limit: limit != null ? Number(limit) : 100,
      });
      sendJson(res, 200, { ok: true, ...out });
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em GET /api/intelligence/goals:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar metas' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/intelligence/goals') {
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const out = await service.createGoal({ tenantId, payload: body || {} });
      sendJson(res, 201, { ok: true, ...out });
    } catch (err) {
      if (String(err?.message || '').includes('required')) {
        badRequest(res, err.message);
        return true;
      }
      logger.error('[IntelligenceRoutes] Erro em POST /api/intelligence/goals:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar meta' });
    }
    return true;
  }

  if (method === 'PUT' && pathname.startsWith('/api/intelligence/goals/')) {
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const goalId = decodeURIComponent(pathname.slice('/api/intelligence/goals/'.length));
      if (!goalId) {
        badRequest(res, 'goalId e obrigatorio');
        return true;
      }

      const body = await parseJsonBody(req);
      const out = await service.updateGoal({ tenantId, goalId, updates: body || {} });

      if (!out.ok) {
        sendJson(res, 404, { error: out.error || 'goal_not_found', message: 'Meta nao encontrada' });
        return true;
      }

      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[IntelligenceRoutes] Erro em PUT /api/intelligence/goals/:id:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar meta' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleIntelligenceGoalRoutes,
};
