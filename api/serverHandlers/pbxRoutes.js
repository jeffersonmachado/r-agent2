async function handlePbxRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    parseMultipartFormData,
    logger,
    buildApiError,
    logAction,
  } = deps;

  if (!pathname.startsWith('/api/pbx') && !pathname.startsWith('/api/cc')) {
    return false;
  }

  // -----------------------------------------------------------------------
  // PBX Legacy (Ripabx / r-pbx) - Somente para conversor / diagnóstico
  // BIG-BANG: o PBX v1 usa /api/pbx/*; legado foi movido para /api/pbx-legacy/*
  // -----------------------------------------------------------------------

  // GET /api/pbx-legacy/health
  if (method === 'GET' && pathname === '/api/pbx-legacy/health') {
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

    try {
      const pbxLegacy = require('../services/pbxLegacy');
      const health = await pbxLegacy.getPbxHealth();
      sendJson(res, 200, health);
    } catch (err) {
      logger.error('[PBX] Erro em /api/pbx-legacy/health', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_health_error',
        message: err.message || 'Erro ao verificar saúde do PBX legado',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx-legacy/inventory
  if (method === 'GET' && pathname === '/api/pbx-legacy/inventory') {
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

    try {
      const pbxLegacy = require('../services/pbxLegacy');
      const inventory = await pbxLegacy.getLegacyInventory();
      sendJson(res, 200, inventory);
    } catch (err) {
      logger.error('[PBX] Erro em /api/pbx-legacy/inventory', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_inventory_error',
        message: err.message || 'Erro ao obter inventário do PBX legado',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx-legacy/ramais
  if (method === 'GET' && pathname === '/api/pbx-legacy/ramais') {
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
    if (!requireTenant(req, res)) return;

    try {
      const pbxLegacy = require('../services/pbxLegacy');
      const ramais = pbxLegacy.listRamais();
      sendJson(res, 200, { items: ramais });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx-legacy/ramais', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_ramais_list_error',
        message: err.message || 'Erro ao listar ramais',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx-legacy/ramais (upsert)
  if (method === 'POST' && pathname === '/api/pbx-legacy/ramais') {
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
    if (!requireTenant(req, res)) return;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const pbxLegacy = require('../services/pbxLegacy');
      const saved = pbxLegacy.upsertRamal(body);
      sendJson(res, 200, { ok: true, item: saved });
    } catch (err) {
      const code = err.code || 'pbx_ramais_upsert_error';
      const httpStatus = code === 'ramal_required' ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx-legacy/ramais', err);
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

  // -----------------------------------------------------------------------
  // PBX v1 (Postgres-first + Asterisk Realtime)
  // -----------------------------------------------------------------------

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
      const pbxExtensions = require('../services/pbx/pbxExtensionsService');
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
      const pbxExtensions = require('../services/pbx/pbxExtensionsService');
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

      const pbxExtensions = require('../services/pbx/pbxExtensionsService');
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
      const { getProvisioningToken } = require('../services/pbx/pbxProvisioningTokenService');
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

      const { rotateProvisioningToken } = require('../services/pbx/pbxProvisioningTokenService');
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
      // Retorna token em texto claro (operação administrativa)
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
      const { revokeProvisioningToken } = require('../services/pbx/pbxProvisioningTokenService');
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
      const { queryLogs: _queryLogs } = require('../services/auditService');
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

  // GET /api/pbx/trunks
  if (method === 'GET' && pathname === '/api/pbx/trunks') {
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
      const pbxTrunks = require('../services/pbx/pbxTrunksService');
      const items = await pbxTrunks.listTrunks({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/trunks', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_trunks_list_error',
        message: err.message || 'Erro ao listar troncos',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/trunks (upsert)
  if (method === 'POST' && pathname === '/api/pbx/trunks') {
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
      const pbxTrunks = require('../services/pbx/pbxTrunksService');
      const actorUserId = req.user?.id || null;
      const item = await pbxTrunks.upsertTrunk({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_trunks_upsert_error';
      const httpStatus = code === 'trunk_name_required' ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/trunks', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar tronco',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx/routes
  if (method === 'GET' && pathname === '/api/pbx/routes') {
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
      const pbxRoutes = require('../services/pbx/pbxRoutesService');
      const direction = url.searchParams.get('direction');
      const items = await pbxRoutes.listRoutes({ tenantKey, direction: direction || null });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/routes', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_routes_list_error',
        message: err.message || 'Erro ao listar rotas',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/routes (upsert)
  if (method === 'POST' && pathname === '/api/pbx/routes') {
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
      const pbxRoutes = require('../services/pbx/pbxRoutesService');
      const actorUserId = req.user?.id || null;
      const item = await pbxRoutes.upsertRoute({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_routes_upsert_error';
      const httpStatus = ['route_direction_invalid', 'route_name_required'].includes(code) ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/routes', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar rota',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx/dids
  if (method === 'GET' && pathname === '/api/pbx/dids') {
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
      const pbxDids = require('../services/pbx/pbxDidsService');
      const items = await pbxDids.listDids({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/dids', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_dids_list_error',
        message: err.message || 'Erro ao listar DIDs',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/dids (upsert)
  if (method === 'POST' && pathname === '/api/pbx/dids') {
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
      const pbxDids = require('../services/pbx/pbxDidsService');
      const actorUserId = req.user?.id || null;
      const item = await pbxDids.upsertDid({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_dids_upsert_error';
      const httpStatus = code === 'did_required' ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/dids', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar DID',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx/call-rules?type=...
  if (method === 'GET' && pathname === '/api/pbx/call-rules') {
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
      const type = urlObj.searchParams.get('type');
      const pbxRules = require('../services/pbx/pbxCallRulesService');
      const items = await pbxRules.listCallRules({ tenantKey, type });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/call-rules', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_call_rules_list_error',
        message: err.message || 'Erro ao listar regras',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/call-rules (upsert)
  if (method === 'POST' && pathname === '/api/pbx/call-rules') {
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
      const pbxRules = require('../services/pbx/pbxCallRulesService');
      const actorUserId = req.user?.id || null;
      const item = await pbxRules.upsertCallRule({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_call_rules_upsert_error';
      const httpStatus = String(code).endsWith('_required') ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/call-rules', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar regra',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx/queues
  if (method === 'GET' && pathname === '/api/pbx/queues') {
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
      const pbxQueues = require('../services/pbx/pbxQueuesService');
      const items = await pbxQueues.listQueues({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/queues', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_queues_list_error',
        message: err.message || 'Erro ao listar filas',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx/queues/metrics
  if (method === 'GET' && pathname === '/api/pbx/queues/metrics') {
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
      const pbxQueues = require('../services/pbx/pbxQueuesService');
      const items = await pbxQueues.getQueueOperationalMetrics({ tenantKey });
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/queues/metrics', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_queues_metrics_error',
        message: err.message || 'Erro ao consultar métricas de fila PBX',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/queues (upsert)
  if (method === 'POST' && pathname === '/api/pbx/queues') {
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
      const pbxQueues = require('../services/pbx/pbxQueuesService');
      const actorUserId = req.user?.id || null;
      const item = await pbxQueues.upsertQueue({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_queues_upsert_error';
      const httpStatus = code === 'queue_name_required' ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/queues', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar fila',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
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
      const pbxDialplan = require('../services/pbx/pbxDialplanService');
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
      const pbxDialplan = require('../services/pbx/pbxDialplanService');
      const rows = await pbxDialplan.buildTenantDialplanRows({ tenantKey });
      const result = await pbxDialplan.applyTenantDialplanRows({ tenantKey, rows });
      const signature = pbxDialplan.computeDialplanSignature(rows);
      // Registra versão aplicada (best-effort)
      try {
        const pbxVersions = require('../services/pbx/pbxConfigVersionsService');
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
        const { logAction } = require('../services/auditService');
        logAction({
          agentId: actorUserId,
          tenantId: tenantKey,
          action: 'pbx.dialplan.publish',
          resource: 'pbx_dialplan',
          resourceId: signature || null,
          details: { count: rows.length, signature: signature || null },
        });
      } catch (_) {}

      sendJson(res, 200, { ok: true, tenantKey, count: result.count, signature });
    } catch (err) {
      // best-effort: registra falha como versão
      try {
        const pbxVersions = require('../services/pbx/pbxConfigVersionsService');
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
      const pbxVersions = require('../services/pbx/pbxConfigVersionsService');
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
      const pbxVersions = require('../services/pbx/pbxConfigVersionsService');
      const pbxDialplan = require('../services/pbx/pbxDialplanService');
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
        const { logAction } = require('../services/auditService');
        logAction({
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
      const ami = require('../services/asterisk/amiClient');
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

  // GET /api/pbx/queue-members?queueId=...
  if (method === 'GET' && pathname === '/api/pbx/queue-members') {
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
      const queueId = urlObj.searchParams.get('queueId');
      if (!queueId) {
        sendJson(res, 400, { error: 'bad_request', message: 'queueId obrigatório' });
        return true;
      }
      const pbxQueueMembers = require('../services/pbx/pbxQueueMembersService');
      const items = await pbxQueueMembers.listQueueMembers({ tenantKey, queueId: String(queueId) });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/queue-members', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_queue_members_list_error',
        message: err.message || 'Erro ao listar membros da fila',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/queue-members (upsert)
  if (method === 'POST' && pathname === '/api/pbx/queue-members') {
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
      const pbxQueueMembers = require('../services/pbx/pbxQueueMembersService');
      const actorUserId = req.user?.id || null;
      const item = await pbxQueueMembers.upsertQueueMember({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_queue_members_upsert_error';
      const httpStatus = [
        'queue_id_required',
        'member_type_invalid',
        'member_ref_required',
        'queue_not_found',
      ].includes(code) ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/queue-members', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar membro da fila',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // DELETE /api/pbx/queue-members?id=...
  if (method === 'DELETE' && pathname === '/api/pbx/queue-members') {
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
      const id = urlObj.searchParams.get('id');
      if (!id) {
        sendJson(res, 400, { error: 'bad_request', message: 'id obrigatório' });
        return true;
      }
      const pbxQueueMembers = require('../services/pbx/pbxQueueMembersService');
      const actorUserId = req.user?.id || null;
      const result = await pbxQueueMembers.deleteQueueMember({ tenantKey, id: String(id), actorUserId });
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      logger.error('[PBX] Erro em DELETE /api/pbx/queue-members', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_queue_members_delete_error',
        message: err.message || 'Erro ao remover membro da fila',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Contact Center (CC) - v1
  // -----------------------------------------------------------------------
  // GET /api/cc/pause-reasons
  if (method === 'GET' && pathname === '/api/cc/pause-reasons') {
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
      const ccReasons = require('../services/cc/ccReasonsService');
      const items = await ccReasons.listPauseReasons({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/pause-reasons', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar motivos de pausa' });
    }
    return true;
  }

  // POST /api/cc/pause-reasons (upsert)
  if (method === 'POST' && pathname === '/api/cc/pause-reasons') {
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
      const ccReasons = require('../services/cc/ccReasonsService');
      const actorUserId = req.user?.id || null;
      const item = await ccReasons.upsertPauseReason({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_pause_reason_upsert_error';
      const httpStatus = String(code).endsWith('_required') ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar motivo de pausa',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/cc/contact-reasons
  if (method === 'GET' && pathname === '/api/cc/contact-reasons') {
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
      const ccReasons = require('../services/cc/ccReasonsService');
      const items = await ccReasons.listContactReasons({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/contact-reasons', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar motivos de contato' });
    }
    return true;
  }

  // POST /api/cc/contact-reasons (upsert)
  if (method === 'POST' && pathname === '/api/cc/contact-reasons') {
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
      const ccReasons = require('../services/cc/ccReasonsService');
      const actorUserId = req.user?.id || null;
      const item = await ccReasons.upsertContactReason({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_contact_reason_upsert_error';
      const httpStatus = String(code).endsWith('_required') ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar motivo de contato',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/cc/campaigns
  if (method === 'GET' && pathname === '/api/cc/campaigns') {
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
      const ccCampaigns = require('../services/cc/ccCampaignsService');
      const items = await ccCampaigns.listCampaigns({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/campaigns', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar campanhas' });
    }
    return true;
  }

  // POST /api/cc/campaigns (upsert)
  if (method === 'POST' && pathname === '/api/cc/campaigns') {
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
      const ccCampaigns = require('../services/cc/ccCampaignsService');
      const actorUserId = req.user?.id || null;
      const item = await ccCampaigns.upsertCampaign({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_campaign_upsert_error';
      const httpStatus = code === 'campaign_name_required' ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar campanha',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/cc/campaigns/list?campaignId=...
  if (method === 'GET' && pathname === '/api/cc/campaigns/list') {
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
      const campaignId = urlObj.searchParams.get('campaignId');
      if (!campaignId) {
        sendJson(res, 400, { error: 'bad_request', message: 'campaignId obrigatório' });
        return true;
      }
      const ccCampaigns = require('../services/cc/ccCampaignsService');
      const items = await ccCampaigns.listCampaignList({ tenantKey, campaignId: String(campaignId) });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/campaigns/list', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar lista de campanha' });
    }
    return true;
  }

  // POST /api/cc/campaigns/list (add items)
  if (method === 'POST' && pathname === '/api/cc/campaigns/list') {
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
      const campaignId = body?.campaignId ? String(body.campaignId) : null;
      if (!campaignId) {
        sendJson(res, 400, { error: 'bad_request', message: 'campaignId obrigatório' });
        return true;
      }
      const ccCampaigns = require('../services/cc/ccCampaignsService');
      const added = await ccCampaigns.addCampaignListItems({ tenantKey, campaignId, items: body?.items || [] });
      sendJson(res, 200, { ok: true, addedCount: added.length, added });
    } catch (err) {
      logger.error('[CC] Erro em POST /api/cc/campaigns/list', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao adicionar itens na campanha' });
    }
    return true;
  }

  // GET /api/cc/scheduled-callbacks
  if (method === 'GET' && pathname === '/api/cc/scheduled-callbacks') {
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
      const ccSched = require('../services/cc/ccScheduledCallbacksService');
      const items = await ccSched.listScheduledCallbacks({ tenantKey });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/scheduled-callbacks', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar agendados' });
    }
    return true;
  }

  // POST /api/cc/scheduled-callbacks (upsert)
  if (method === 'POST' && pathname === '/api/cc/scheduled-callbacks') {
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
      const ccSched = require('../services/cc/ccScheduledCallbacksService');
      const actorUserId = req.user?.id || null;
      const item = await ccSched.upsertScheduledCallback({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_scheduled_upsert_error';
      const httpStatus = ['scheduled_at_invalid', 'scheduled_phone_required'].includes(code) ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao salvar agendado',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/cc/click2call
  if (method === 'GET' && pathname === '/api/cc/click2call') {
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
      const limit = urlObj.searchParams.get('limit') || '100';
      const ccC2C = require('../services/cc/ccClick2CallService');
      const items = await ccC2C.listClick2CallRequests({ tenantKey, limit });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[CC] Erro em GET /api/cc/click2call', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar click2call' });
    }
    return true;
  }

  // POST /api/cc/click2call
  if (method === 'POST' && pathname === '/api/cc/click2call') {
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
      const ccC2C = require('../services/cc/ccClick2CallService');
      const actorUserId = req.user?.id || null;
      const item = await ccC2C.createClick2CallRequest({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'cc_click2call_create_error';
      const httpStatus = String(code).endsWith('_required') ? 400 : 500;
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao criar click2call',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // PBX - Mídia (áudios) / Gravações
  // -----------------------------------------------------------------------
  // GET /api/pbx/audio-assets?kind=...
  if (method === 'GET' && pathname === '/api/pbx/audio-assets') {
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
      const kind = urlObj.searchParams.get('kind');
      const pbxMedia = require('../services/pbx/pbxMediaService');
      const items = await pbxMedia.listAudioAssets({ tenantKey, kind });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/audio-assets', err);
      sendJson(res, 500, buildApiError({
        code: 'pbx_audio_assets_list_error',
        message: err.message || 'Erro ao listar áudios',
        httpStatus: 500,
        retryable: true,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx/audio-assets/upload (multipart)
  if (method === 'POST' && pathname === '/api/pbx/audio-assets/upload') {
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
      const { fields, files } = await parseMultipartFormData(req);
      const kind = fields.kind || fields.dir || null; // legado usa ?dir=espera|sons
      const file = Array.isArray(files) ? files.find(f => f.fieldname === 'file') || files[0] : null;
      if (!file) {
        badRequest(res, 'Arquivo obrigatório (field "file")');
        return true;
      }
      // Limite: 25MB
      if (file.size > 25 * 1024 * 1024) {
        sendJson(res, 413, { error: 'payload_too_large', message: 'Arquivo maior que 25MB' });
        return true;
      }
      const pbxMedia = require('../services/pbx/pbxMediaService');
      const actorUserId = req.user?.id || null;
      const item = await pbxMedia.createAudioAssetFromUpload({
        tenantKey,
        kind,
        filename: file.filename,
        mimeType: file.mimeType,
        buffer: file.buffer,
        actorUserId,
      });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_audio_upload_error';
      const httpStatus = ['audio_kind_required', 'audio_file_required'].includes(code) ? 400 : 500;
      logger.error('[PBX] Erro em POST /api/pbx/audio-assets/upload', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: err.message || 'Erro ao fazer upload de áudio',
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // GET /api/pbx/audio-assets/file?id=... (download)
  if (method === 'GET' && pathname === '/api/pbx/audio-assets/file') {
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
      const id = urlObj.searchParams.get('id');
      if (!id) {
        badRequest(res, 'id obrigatório');
        return true;
      }
      const { PbxAudioAsset } = require('../db/models');
      const row = await PbxAudioAsset().findOne({ where: { id: String(id), tenantKey } });
      if (!row) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      const pbxMedia = require('../services/pbx/pbxMediaService');
      const filePath = pbxMedia.resolveAudioFilePath(row.toJSON());
      if (!filePath) {
        sendJson(res, 404, { error: 'file_not_found' });
        return true;
      }
      // eslint-disable-next-line global-require
      const fs = require('fs');
      // eslint-disable-next-line global-require
      const p = require('path');
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${p.basename(filePath)}"`,
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/audio-assets/file', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao baixar áudio' });
    }
    return true;
  }

  // GET /api/pbx/recordings?limit=...
  if (method === 'GET' && pathname === '/api/pbx/recordings') {
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
      const limit = urlObj.searchParams.get('limit') || '200';
      const pbxRec = require('../services/pbx/pbxRecordingsService');
      const items = await pbxRec.listRecordings({ tenantKey, limit });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/recordings', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar gravações' });
    }
    return true;
  }

  // GET /api/pbx/recordings/policy
  if (method === 'GET' && pathname === '/api/pbx/recordings/policy') {
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
      const policyService = require('../services/pbx/pbxRecordingPolicyService');
      const out = await policyService.getRecordingPolicy({ tenantKey });
      if (!out.ok) {
        sendJson(res, 500, { error: 'internal_error', message: out.error || 'Erro ao obter política' });
        return true;
      }
      sendJson(res, 200, { ok: true, policy: out.policy });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/recordings/policy', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter política de gravação' });
    }
    return true;
  }

  // POST /api/pbx/recordings/policy
  if (method === 'POST' && pathname === '/api/pbx/recordings/policy') {
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
      const body = await parseJsonBody(req);
      const policyService = require('../services/pbx/pbxRecordingPolicyService');
      const out = await policyService.setRecordingPolicy({ tenantKey, policy: body || {} });
      if (!out.ok) {
        sendJson(res, 500, { error: 'internal_error', message: out.error || 'Erro ao salvar política' });
        return true;
      }
      try {
        const { logAction } = require('../services/auditService');
        const actorUserId = req.agent?.id || req.agent?.username || null;
        logAction({
          agentId: actorUserId,
          tenantId: tenantKey,
          action: 'pbx.recordings.policy.update',
          resource: 'pbx_recording_policy',
          resourceId: tenantKey,
          details: out.policy,
        });
      } catch (_) {}
      sendJson(res, 200, { ok: true, policy: out.policy });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/recordings/policy', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar política de gravação' });
    }
    return true;
  }

  // POST /api/pbx/recordings/scan
  if (method === 'POST' && pathname === '/api/pbx/recordings/scan') {
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
      const pbxRec = require('../services/pbx/pbxRecordingsService');
      const result = await pbxRec.scanAndUpsertRecordings({ tenantKey });
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      logger.error('[PBX] Erro em POST /api/pbx/recordings/scan', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao varrer gravações' });
    }
    return true;
  }

  // GET /api/pbx/recordings/file?id=...
  if (method === 'GET' && pathname === '/api/pbx/recordings/file') {
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
      const id = urlObj.searchParams.get('id');
      if (!id) {
        badRequest(res, 'id obrigatório');
        return true;
      }
      const pbxRec = require('../services/pbx/pbxRecordingsService');
      const filePath = await pbxRec.getRecordingFilePath({ tenantKey, id: String(id) });
      if (!filePath) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }
      try {
        const { logAction } = require('../services/auditService');
        const actorUserId = req.agent?.id || req.agent?.username || null;
        logAction({
          agentId: actorUserId,
          tenantId: tenantKey,
          action: 'pbx.recordings.download',
          resource: 'pbx_recording',
          resourceId: String(id),
          details: { id: String(id) },
        });
      } catch (_) {}
      // eslint-disable-next-line global-require
      const fs = require('fs');
      // eslint-disable-next-line global-require
      const p = require('path');
      const buf = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Disposition': `attachment; filename="${p.basename(filePath)}"`,
        'Content-Length': buf.length,
      });
      res.end(buf);
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/recordings/file', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao baixar gravação' });
    }
    return true;
  }

  // GET /api/pbx/cdr?limit=...&from=...&to=...&src=...&dst=...&uniqueid=...
  if (method === 'GET' && pathname === '/api/pbx/cdr') {
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
      const pbxCdr = require('../services/pbx/pbxCdrService');
      const items = await pbxCdr.listCdr({
        tenantKey,
        filters: {
          limit: urlObj.searchParams.get('limit') || null,
          from: urlObj.searchParams.get('from') || null,
          to: urlObj.searchParams.get('to') || null,
          src: urlObj.searchParams.get('src') || null,
          dst: urlObj.searchParams.get('dst') || null,
          uniqueid: urlObj.searchParams.get('uniqueid') || null,
        },
      });
      sendJson(res, 200, { items });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/cdr', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar CDR' });
    }
    return true;
  }

  return false;
}

module.exports = { handlePbxRoutes };
