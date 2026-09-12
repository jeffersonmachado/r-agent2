async function handlePbxDialplanRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    logger,
    buildApiError,
  } = deps;

  const matchesDialplanRoute = pathname.startsWith('/api/pbx/dialplan') || pathname === '/api/pbx/config-versions';
  if (!matchesDialplanRoute) {
    return false;
  }

  // POST /api/pbx/dialplan/preview
  if (method === 'POST' && pathname === '/api/pbx/dialplan/preview') {
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
      const pbxDialplan = require('../../../services/pbx/pbxDialplanService');
      const rows = await pbxDialplan.buildTenantDialplanRows({ tenantKey });
      sendJson(res, 200, { ok: true, tenantKey, count: rows.length, rows });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/dialplan/preview', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_dialplan_preview_error',
        message: err.message || 'Erro ao gerar preview do dialplan',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/dialplan/apply
  if (method === 'POST' && pathname === '/api/pbx/dialplan/apply') {
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
      const pbxDialplan = require('../../../services/pbx/pbxDialplanService');
      const rows = await pbxDialplan.buildTenantDialplanRows({ tenantKey });
      const result = await pbxDialplan.applyTenantDialplanRows({ tenantKey, rows });
      // Contextos realtime por tenant: sem isto o dialplan é persistido no banco mas o
      // Asterisk nunca o executa, porque o switch Realtime exige a declaração explícita do
      // contexto (ver syncRealtimeTenantContexts em pbxDialplanService).
      const realtimeContexts = await pbxDialplan.syncRealtimeTenantContexts();
      if (realtimeContexts && realtimeContexts.ok === false && !realtimeContexts.skipped) {
        logger.error('[PBX] Falha ao propagar contextos realtime do dialplan', realtimeContexts);
      }
      const signature = pbxDialplan.computeDialplanSignature(rows);
      try {
        const pbxVersions = require('../../../services/pbx/pbxConfigVersionsService');
        const actorUserId = req.agent?.id || req.agent?.username || null;
        await pbxVersions.createVersion({
          tenantKey,
          status: 'applied',
          createdByUserId: actorUserId,
          summary: {
            appliedAt: new Date().toISOString(),
            dialplan: {
              count: rows.length,
              signature: signature || null,
              rows,
            },
          },
        });
        const { logAction: _logAction } = require('../../../services/auditService');
        _logAction({
          agentId: actorUserId,
          tenantId: tenantKey,
          action: 'pbx.dialplan.publish',
          resource: 'pbx_dialplan',
          resourceId: signature || null,
          details: { count: rows.length, signature: signature || null },
        });
      } catch (_) {}

      sendJson(res, 200, { ok: true, tenantKey, count: result.count, signature, realtimeContexts });
    } catch (err) {
      try {
        const pbxVersions = require('../../../services/pbx/pbxConfigVersionsService');
        const actorUserId = req.agent?.id || req.agent?.username || null;
        await pbxVersions.createVersion({
          tenantKey,
          status: 'failed',
          createdByUserId: actorUserId,
          summary: {
            failedAt: new Date().toISOString(),
            error: err && err.message ? String(err.message) : 'apply_failed',
          },
        });
      } catch (_) {}

      logger.error('[PBX] Erro em POST /api/pbx/dialplan/apply', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_dialplan_apply_error',
        message: err.message || 'Erro ao aplicar dialplan',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx/config-versions?limit=...
  if (method === 'GET' && pathname === '/api/pbx/config-versions') {
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
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit') || '20';
      const pbxVersions = require('../../../services/pbx/pbxConfigVersionsService');
      const items = await pbxVersions.listVersions({ tenantKey, limit });
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/config-versions', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_config_versions_list_error',
        message: err.message || 'Erro ao listar versões PBX',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/dialplan/rollback?version=...
  if (method === 'POST' && pathname === '/api/pbx/dialplan/rollback') {
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
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const version = Number(urlObj.searchParams.get('version'));
      if (!Number.isFinite(version) || version <= 0) {
        badRequest(res, 'version obrigatório');
        return true;
      }
      const pbxVersions = require('../../../services/pbx/pbxConfigVersionsService');
      const pbxDialplan = require('../../../services/pbx/pbxDialplanService');
      const target = await pbxVersions.getVersionByNumber({ tenantKey, version });
      const rows = Array.isArray(target?.summary?.dialplan?.rows) ? target.summary.dialplan.rows : null;
      if (!target || !rows || rows.length === 0) {
        sendJson(res, 404, { error: 'not_found', message: 'versão sem snapshot de dialplan' });
        return true;
      }

      const result = await pbxDialplan.applyTenantDialplanRows({ tenantKey, rows });
      const signature = pbxDialplan.computeDialplanSignature(rows);
      const actorUserId = req.agent?.id || req.agent?.username || null;
      await pbxVersions.createVersion({
        tenantKey,
        status: 'applied',
        createdByUserId: actorUserId,
        summary: {
          rollbackAt: new Date().toISOString(),
          rolledBackFromVersion: Number(version),
          dialplan: {
            count: rows.length,
            signature,
            rows,
          },
        },
      });
      try {
        const { logAction: _logAction } = require('../../../services/auditService');
        _logAction({
          agentId: actorUserId,
          tenantId: tenantKey,
          action: 'pbx.dialplan.rollback',
          resource: 'pbx_dialplan',
          resourceId: String(version),
          details: { version: Number(version), count: rows.length, signature },
        });
      } catch (_) {}
      sendJson(res, 200, { ok: true, tenantKey, version, count: result.count, signature });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/dialplan/rollback', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_dialplan_rollback_error',
        message: err.message || 'Erro ao fazer rollback do dialplan',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  return false;
}

module.exports = { handlePbxDialplanRoutes };
