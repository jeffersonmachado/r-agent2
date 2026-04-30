async function handleAuditRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson, queryLogs, getAuditStats } = deps;

  function isDatabaseUnavailableError(err) {
    const text = String(err?.message || err || '').toLowerCase();
    return (
      text.includes('postgresql não está disponível')
      || text.includes('connectionmanager.getconnection was called after the connection manager was closed')
      || text.includes('connection manager was closed')
      || text.includes('connection terminated unexpectedly')
    );
  }

  if (!pathname.startsWith('/audit/')) {
    return false;
  }

  // GET /audit/logs
  if (method === 'GET' && pathname === '/audit/logs') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'audit', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const filters = {
      agentId: urlObj.searchParams.get('agentId') || undefined,
      username: urlObj.searchParams.get('username') || undefined,
      action: urlObj.searchParams.get('action') || undefined,
      resource: urlObj.searchParams.get('resource') || undefined,
      resourceId: urlObj.searchParams.get('resourceId') || undefined,
      // Hardening: tenant é sempre resolvido pelo agente (ou X-Tenant-Id para super-admin via middleware/auth)
      tenantId: req.tenantId || undefined,
      startDate: urlObj.searchParams.get('startDate') || undefined,
      endDate: urlObj.searchParams.get('endDate') || undefined,
      limit: urlObj.searchParams.get('limit') || undefined,
      offset: urlObj.searchParams.get('offset') || undefined,
    };

    try {
      const result = await queryLogs(filters);
      sendJson(res, 200, result);
    } catch (err) {
      if (isDatabaseUnavailableError(err)) {
        sendJson(res, 200, { total: 0, items: [], degraded: true });
      } else {
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao consultar auditoria' });
      }
    }
    return true;
  }

  // GET /audit/stats
  if (method === 'GET' && pathname === '/audit/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'audit', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const stats = await getAuditStats();
      sendJson(res, 200, stats);
    } catch (err) {
      if (isDatabaseUnavailableError(err)) {
        sendJson(res, 200, {
          total: 0,
          byAction: {},
          byResource: {},
          byAgent: {},
          recent: [],
          degraded: true,
        });
      } else {
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao consultar estatísticas de auditoria' });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleAuditRoutes };
