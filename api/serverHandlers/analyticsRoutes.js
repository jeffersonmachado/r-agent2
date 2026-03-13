module.exports = { handleAnalyticsRoutes };

async function handleAnalyticsRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    logger,
    getAllMetrics,
    getGeneralMetrics,
    getAgentMetrics,
    getDepartmentMetrics,
    getQueueMetrics,
    getTrendMetrics,
  } = deps;

  if (method === 'GET' && pathname === '/analytics/metrics') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: requireTenant(req, res),
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };
      if (!options.tenantId) return true;

      const metrics = await getAllMetrics(options);
      sendJson(res, 200, metrics);
    } catch (err) {
      logger.error('Erro ao obter métricas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/analytics/roi') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const windowDays = urlObj.searchParams.get('windowDays');
      const { getRoiSummary } = require('../services/roiService');
      const out = await getRoiSummary({
        tenantId: req.tenantId,
        windowDays: windowDays != null ? Number(windowDays) : null,
      });
      if (!out.ok) {
        sendJson(res, 400, { ok: false, error: out.error || 'roi_unavailable' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('Erro ao obter ROI:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/analytics/funnel') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const windowDays = urlObj.searchParams.get('windowDays');
      const { getFunnelMetrics } = require('../services/roiService');
      const out = await getFunnelMetrics({
        tenantId: req.tenantId,
        windowDays: windowDays != null ? Number(windowDays) : null,
      });
      if (!out.ok) {
        sendJson(res, 400, { ok: false, error: out.error || 'funnel_unavailable' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('Erro ao obter funil:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/analytics/general') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const metrics = await getGeneralMetrics(options);
      sendJson(res, 200, metrics);
    } catch (err) {
      logger.error('Erro ao obter métricas gerais:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/analytics/agents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const metrics = await getAgentMetrics(options);
      sendJson(res, 200, { agents: metrics });
    } catch (err) {
      logger.error('Erro ao obter métricas de agentes:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/analytics/departments') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const metrics = getDepartmentMetrics(options);
      sendJson(res, 200, { departments: metrics });
    } catch (err) {
      logger.error('Erro ao obter métricas de departamentos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/analytics/queues') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const metrics = getQueueMetrics(options);
      sendJson(res, 200, { queues: metrics });
    } catch (err) {
      logger.error('Erro ao obter métricas de filas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/analytics/trends') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const options = {
        tenantId: req.tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
        groupBy: urlObj.searchParams.get('groupBy') || 'day',
      };

      const metrics = getTrendMetrics(options);
      sendJson(res, 200, { trends: metrics });
    } catch (err) {
      logger.error('Erro ao obter métricas de tendência:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  return false;
}