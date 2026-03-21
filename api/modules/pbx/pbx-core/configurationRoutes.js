async function handlePbxConfigurationRoutes(ctx) {
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
  } = deps;

  const matchesConfigRoute =
    pathname === '/api/pbx/trunks' ||
    pathname === '/api/pbx/routes' ||
    pathname === '/api/pbx/dids' ||
    pathname === '/api/pbx/call-rules';

  if (!matchesConfigRoute) {
    return false;
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
      const pbxTrunks = require('../../../services/pbx/pbxTrunksService');
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
      const pbxTrunks = require('../../../services/pbx/pbxTrunksService');
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
      const pbxRoutes = require('../../../services/pbx/pbxRoutesService');
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const direction = urlObj.searchParams.get('direction');
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
      const pbxRoutes = require('../../../services/pbx/pbxRoutesService');
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
      const pbxDids = require('../../../services/pbx/pbxDidsService');
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
      const pbxDids = require('../../../services/pbx/pbxDidsService');
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
      const pbxRules = require('../../../services/pbx/pbxCallRulesService');
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
      const pbxRules = require('../../../services/pbx/pbxCallRulesService');
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

  return false;
}

module.exports = { handlePbxConfigurationRoutes };
