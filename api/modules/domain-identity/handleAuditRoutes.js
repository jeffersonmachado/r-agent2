async function handleAuditRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson, queryLogs, getAuditStats } = deps;

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

    const result = await queryLogs(filters);
    sendJson(res, 200, result);
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

    const stats = await getAuditStats();
    sendJson(res, 200, stats);
    return true;
  }

  return false;
}

module.exports = { handleAuditRoutes };
