module.exports = { handleExportRoutes };

async function handleExportRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    logger,
    exportTicketsCSV,
    exportMetricsCSV,
    exportConversationsJSON,
    exportFullReportJSON,
  } = deps;

  if (method === 'GET' && pathname === '/export/tickets.csv') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'export');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const options = {
        tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
        status: urlObj.searchParams.get('status') || undefined,
        queue: urlObj.searchParams.get('queue') || undefined,
      };

      const csv = exportTicketsCSV(options);
      const filename = `tickets_${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.writeHead(200);
      res.end('\ufeff' + csv);
    } catch (err) {
      logger.error('Erro ao exportar tickets:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/export/metrics.csv') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'export');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const options = {
        tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const csv = exportMetricsCSV(options);
      const filename = `metrics_${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.writeHead(200);
      res.end('\ufeff' + csv);
    } catch (err) {
      logger.error('Erro ao exportar métricas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/export/conversations.json') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'export');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const options = {
        tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const data = exportConversationsJSON(options);
      const filename = `conversations_${new Date().toISOString().split('T')[0]}.json`;

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      sendJson(res, 200, data);
    } catch (err) {
      logger.error('Erro ao exportar conversas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/export/full-report.json') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'export');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const options = {
        tenantId,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const data = exportFullReportJSON(options);
      const filename = `full-report_${new Date().toISOString().split('T')[0]}.json`;

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      sendJson(res, 200, data);
    } catch (err) {
      logger.error('Erro ao exportar relatório completo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  return false;
}