async function handlePbxExtensionsProvisioningRoutes(ctx) {
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

  if (!pathname.startsWith('/api/pbx/extensions') && !pathname.startsWith('/api/pbx/provisioning-token')) {
    return false;
  }

  // GET /api/pbx/extensions
  if (method === 'GET' && pathname === '/api/pbx/extensions') {
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
      const pbxExtensions = require('../../services/pbx/pbxExtensionsService');
      const items = await pbxExtensions.listExtensions({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/extensions', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_extensions_list_error',
        message: err.message || 'Erro ao listar ramais',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/extensions (upsert)
  if (method === 'POST' && pathname === '/api/pbx/extensions') {
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
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const pbxExtensions = require('../../services/pbx/pbxExtensionsService');
      const actorUserId = req.user?.id || null;
      const item = await pbxExtensions.upsertExtension({ tenantKey, payload: body, actorUserId });
      try {
        logAction({
          agentId: req.user?.id || null,
          username: req.user?.username || null,
          tenantId: tenantKey,
          action: 'pbx.extensions.upsert',
          resource: 'pbx_extension',
          resourceId: item?.id || null,
          details: {
            extension: item?.extension || null,
            provisioning: item?.endpointOptions?.provisioning?.enabled ? true : false,
            vendor: item?.endpointOptions?.provisioning?.vendor || null,
            model: item?.endpointOptions?.provisioning?.model || null,
            firmware: item?.endpointOptions?.provisioning?.firmware || null,
          },
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_extensions_upsert_error';
      const httpStatus = ['extension_required', 'invalid_mac', 'invalid_provisioning_vendor', 'invalid_provisioning_settings_key', 'provisioning_mac_required', 'mac_already_assigned', 'weak_extension_password', 'provisioning_extension_inactive'].includes(code)
        ? 400
        : 500;
      logger.error('[PBX] Erro em POST /api/pbx/extensions', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar ramal',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/extensions/bulk - upsert em lote (provisioning/parque)
  if (method === 'POST' && pathname === '/api/pbx/extensions/bulk') {
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
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const items = body && Array.isArray(body.items) ? body.items : null;
      if (!items || items.length === 0) {
        badRequest(res, 'Campo "items" (array) é obrigatório');
        return true;
      }
      if (items.length > 500) {
        badRequest(res, 'Máximo de 500 itens por lote');
        return true;
      }

      const pbxExtensions = require('../../services/pbx/pbxExtensionsService');
      const actorUserId = req.user?.id || null;
      const results = [];
      for (const payload of items) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const item = await pbxExtensions.upsertExtension({ tenantKey, payload, actorUserId });
          results.push({ ok: true, item });
        } catch (err) {
          results.push({
            ok: false,
            code: err?.code || 'pbx_extensions_bulk_item_error',
            message: err?.message || 'Erro ao salvar item',
            details: err?.details || null,
            payloadHint: payload && typeof payload === 'object' ? { extension: payload.extension || payload.ramal || null } : null,
          });
        }
      }

      const okCount = results.filter((r) => r.ok).length;
      try {
        logAction({
          agentId: req.user?.id || null,
          username: req.user?.username || null,
          tenantId: tenantKey,
          action: 'pbx.extensions.bulk',
          resource: 'pbx_extension',
          resourceId: null,
          details: {
            total: results.length,
            okCount,
            errorCount: results.length - okCount,
          },
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}
      sendJson(res, 200, { ok: true, okCount, errorCount: results.length - okCount, results });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/extensions/bulk', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_extensions_bulk_error',
        message: err.message || 'Erro ao processar lote de ramais',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx/provisioning-token - retorna token (mascarado) por tenant
  if (method === 'GET' && pathname === '/api/pbx/provisioning-token') {
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
      const { getProvisioningToken } = require('../../services/pbx/pbxProvisioningTokenService');
      const result = await getProvisioningToken({ tenantKey, includeToken: false });
      if (!result.ok) {
        sendJson(res, 404, { error: 'not_found', message: 'Tenant PBX não encontrado' });
        return true;
      }
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/provisioning-token', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter token de provisioning' });
    }
    return true;
  }

  // POST /api/pbx/provisioning-token/rotate - rotaciona token por tenant
  if (method === 'POST' && pathname === '/api/pbx/provisioning-token/rotate') {
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
      const expiresInSecRaw = urlObj.searchParams.get('expiresInSec');
      const expiresInSec = expiresInSecRaw != null ? Number(expiresInSecRaw) : null;

      const { rotateProvisioningToken } = require('../../services/pbx/pbxProvisioningTokenService');
      const result = await rotateProvisioningToken({ tenantKey, actorUserId: req.agent?.id || null, expiresInSec });
      if (!result.ok) {
        sendJson(res, 404, { error: 'not_found', message: 'Tenant PBX não encontrado' });
        return true;
      }
      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: tenantKey,
          action: 'pbx.provisioning_token.rotate',
          resource: 'pbx_provisioning_token',
          resourceId: tenantKey,
          details: { expiresInSec: expiresInSec != null ? expiresInSec : null, expiresAt: result.expiresAt || null },
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}
      sendJson(res, 200, { ok: true, token: result.token });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/provisioning-token/rotate', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao rotacionar token de provisioning' });
    }
    return true;
  }

  // POST /api/pbx/provisioning-token/revoke - revoga token por tenant
  if (method === 'POST' && pathname === '/api/pbx/provisioning-token/revoke') {
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
      const { revokeProvisioningToken } = require('../../services/pbx/pbxProvisioningTokenService');
      const result = await revokeProvisioningToken({ tenantKey, actorUserId: req.agent?.id || null });
      if (!result.ok) {
        sendJson(res, 404, { error: 'not_found', message: 'Tenant PBX não encontrado' });
        return true;
      }
      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: tenantKey,
          action: 'pbx.provisioning_token.revoke',
          resource: 'pbx_provisioning_token',
          resourceId: tenantKey,
          details: {},
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}
      sendJson(res, 200, { ok: true });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/provisioning-token/revoke', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao revogar token de provisioning' });
    }
    return true;
  }

  return false;
}

module.exports = { handlePbxExtensionsProvisioningRoutes };
