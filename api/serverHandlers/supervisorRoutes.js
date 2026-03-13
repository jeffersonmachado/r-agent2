module.exports = { handleSupervisorRoutes };

async function handleSupervisorRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    logger,
    getSupervisorMetrics,
    getGeneralMetrics,
    getSupervisorAgentStatus,
    getSupervisorQueueStatus,
  } = deps;

  if (method === 'GET' && pathname === '/supervisor/metrics') {
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

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const groupBy = urlObj.searchParams.get('groupBy') || 'agent';
      const period = urlObj.searchParams.get('period') || 'day';
      const from = urlObj.searchParams.get('from') || undefined;
      const to = urlObj.searchParams.get('to') || undefined;

      const metrics = await getSupervisorMetrics({
        tenantId,
        groupBy,
        period,
        from,
        to,
      });

      const summary = await getGeneralMetrics({
        tenantId,
        startDate: from || undefined,
        endDate: to || undefined,
      });

      sendJson(res, 200, { summary, ...metrics });
    } catch (err) {
      logger.error('Erro ao obter métricas de supervisor:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/supervisor/agents/status') {
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

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const agents = await getSupervisorAgentStatus({ tenantId });
      sendJson(res, 200, { agents });
    } catch (err) {
      logger.error('Erro ao obter status de agentes:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/supervisor/queues/status') {
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

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    try {
      const queues = await getSupervisorQueueStatus({ tenantId });
      sendJson(res, 200, { queues });
    } catch (err) {
      logger.error('Erro ao obter status de filas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  return false;
}