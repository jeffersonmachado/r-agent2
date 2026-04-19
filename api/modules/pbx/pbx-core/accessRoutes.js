'use strict';

async function handlePbxAccessRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    buildApiError,
    logAction,
  } = deps;

  if (pathname !== '/api/pbx/acls') {
    return false;
  }

  if (method === 'GET') {
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
    if (!tenantKey) return true;

    try {
      const pbxAcls = require('../../../services/pbx/pbxAclsService');
      const items = await pbxAcls.listAcls({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/acls', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_acls_list_error',
        message: err.message || 'Erro ao listar ACLs',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  if (method === 'POST') {
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
    if (!tenantKey) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const pbxAcls = require('../../../services/pbx/pbxAclsService');
      const item = await pbxAcls.upsertAcl({
        tenantKey,
        payload: body,
        actorUserId: req.agent?.id || req.agent?.username || null,
      });

      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: tenantKey,
          action: 'pbx.acls.upsert',
          resource: 'pbx_acl',
          resourceId: item.id,
          details: { name: item.name, enabled: item.enabled },
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_acls_upsert_error';
      const httpStatus = ['acl_name_required'].includes(code) ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/acls', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar ACL',
        httpStatus,
        retryable: httpStatus >= 500,
        details: err.details || null,
        req,
      }));
    }
    return true;
  }

  if (method === 'DELETE') {
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
    if (!tenantKey) return true;

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const id = url.searchParams.get('id');
      const pbxAcls = require('../../../services/pbx/pbxAclsService');
      const removed = await pbxAcls.deleteAcl({ tenantKey, id });
      if (!removed) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }

      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: tenantKey,
          action: 'pbx.acls.delete',
          resource: 'pbx_acl',
          resourceId: id,
          details: null,
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 200, { ok: true });
    } catch (err) {
      const code = err.code || 'pbx_acls_delete_error';
      const httpStatus = ['acl_id_required'].includes(code) ? 400 : 500;
      logger.error('[PBX] Erro em DELETE /api/pbx/acls', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao remover ACL',
        httpStatus,
        retryable: httpStatus >= 500,
        details: err.details || null,
        req,
      }));
    }
    return true;
  }

  return false;
}

module.exports = {
  handlePbxAccessRoutes,
};
