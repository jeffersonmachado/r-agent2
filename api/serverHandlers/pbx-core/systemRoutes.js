async function handlePbxSystemRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    logger,
    buildApiError,
  } = deps;

  if (pathname !== '/api/pbx/audit' && pathname !== '/api/pbx/reload') {
    return false;
  }

  // GET /api/pbx/audit?hours=...&limit=... - visão de auditoria PBX
  if (method === 'GET' && pathname === '/api/pbx/audit') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;

    try {
      const { queryLogs: _queryLogs } = require('../../services/auditService');
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const rawHours = Number(urlObj.searchParams.get('hours') || 72);
      const rawLimit = Number(urlObj.searchParams.get('limit') || 300);
      const hours = Number.isFinite(rawHours) ? Math.max(1, Math.min(24 * 30, Math.floor(rawHours))) : 72;
      const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(1000, Math.floor(rawLimit))) : 300;
      const startDate = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();

      const result = await _queryLogs({
        tenantId: tenantKey,
        startDate,
        limit,
        offset: 0,
      });
      const pbxItems = (result?.items || []).filter((item) => String(item?.action || '').startsWith('pbx.'));
      const byAction = {};
      for (const item of pbxItems) {
        const action = String(item?.action || 'unknown');
        byAction[action] = (byAction[action] || 0) + 1;
      }

      sendJson(res, 200, {
        ok: true,
        hours,
        total: pbxItems.length,
        byAction,
        items: pbxItems,
      });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/audit', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao consultar auditoria PBX' });
    }
    return true;
  }

  // POST /api/pbx/reload (best-effort: core reload + pjsip via AMI)
  if (method === 'POST' && pathname === '/api/pbx/reload') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return;
    try {
      const ami = require('../../services/asterisk/amiClient');
      const core = await ami.command('core reload');
      const pjsip = await ami.command('pjsip reload');
      const odbc = await ami.command('module reload res_odbc.so res_config_odbc.so');
      sendJson(res, 200, { ok: true, tenantKey, core: !!core.ok, pjsip: !!pjsip.ok, odbc: !!odbc.ok });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/reload', err);
      sendJson(res, 500, buildApiError({
        code: err.code || 'pbx_reload_error',
        message: err.message || 'Erro ao recarregar Asterisk',
        httpStatus: 500,
        retryable: true,
        details: err.details || null,
        req,
      }));
    }
    return true;
  }

  return false;
}

module.exports = { handlePbxSystemRoutes };
