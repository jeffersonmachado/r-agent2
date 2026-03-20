// PBX Legacy (Ripabx / r-pbx) - Somente para conversor / diagnóstico
// BIG-BANG: o PBX v1 usa /api/pbx/*; legado foi movido para /api/pbx-legacy/*

async function handlePbxLegacyRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    hasJsonContentType,
    parseJsonBody,
    logger,
    buildApiError,
  } = deps;

  if (!pathname.startsWith('/api/pbx-legacy')) {
    return false;
  }

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
      const pbxLegacy = require('../../services/pbxLegacy');
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
      const pbxLegacy = require('../../services/pbxLegacy');
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
      const pbxLegacy = require('../../services/pbxLegacy');
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
      const { badRequest } = deps;
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const pbxLegacy = require('../../services/pbxLegacy');
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

  return false;
}

module.exports = { handlePbxLegacyRoutes };
