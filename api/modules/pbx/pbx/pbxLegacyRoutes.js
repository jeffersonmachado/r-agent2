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
      const pbxLegacy = require('../../../services/pbxLegacy');
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
      const pbxLegacy = require('../../../services/pbxLegacy');
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
      const pbxLegacy = require('../../../services/pbxLegacy');
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
      const pbxLegacy = require('../../../services/pbxLegacy');
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

  // GET /api/pbx-legacy/xml-entities?entity=<entidade>
  if (method === 'GET' && pathname === '/api/pbx-legacy/xml-entities') {
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
      const entity = new URL(req.url, 'http://localhost').searchParams.get('entity');
      const xmlEntities = require('../../../services/pbxLegacy/xmlEntities');
      const result = xmlEntities.listXmlEntities(entity);
      sendJson(res, 200, result);
    } catch (err) {
      const { code, httpStatus } = mapXmlEntityError(err);
      logger.error('[PBX] Erro em GET /api/pbx-legacy/xml-entities', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: xmlEntityErrorMessage(err, code),
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // POST /api/pbx-legacy/xml-entities?entity=<entidade> (upsert)
  if (method === 'POST' && pathname === '/api/pbx-legacy/xml-entities') {
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
      const entity = new URL(req.url, 'http://localhost').searchParams.get('entity');
      const body = await parseJsonBody(req);
      const xmlEntities = require('../../../services/pbxLegacy/xmlEntities');
      const saved = xmlEntities.upsertXmlEntity(entity, body);
      sendJson(res, 200, { ok: true, item: saved });
    } catch (err) {
      const { code, httpStatus } = mapXmlEntityError(err);
      logger.error('[PBX] Erro em POST /api/pbx-legacy/xml-entities', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: xmlEntityErrorMessage(err, code),
        httpStatus,
        retryable: httpStatus >= 500,
        details: null,
        req,
      }));
    }
    return true;
  }

  // DELETE /api/pbx-legacy/xml-entities?entity=<entidade>&id=<id>
  if (method === 'DELETE' && pathname === '/api/pbx-legacy/xml-entities') {
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

    try {
      const searchParams = new URL(req.url, 'http://localhost').searchParams;
      const xmlEntities = require('../../../services/pbxLegacy/xmlEntities');
      const result = xmlEntities.removeXmlEntity(searchParams.get('entity'), searchParams.get('id'));
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      const { code, httpStatus } = mapXmlEntityError(err);
      logger.error('[PBX] Erro em DELETE /api/pbx-legacy/xml-entities', err);
      sendJson(res, httpStatus, buildApiError({
        code,
        message: xmlEntityErrorMessage(err, code),
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

const XML_ENTITY_ERROR_STATUS = {
  pbx_xml_dir_not_configured: 400,
  unknown_entity: 400,
  id_required: 400,
  not_found: 404,
};

function mapXmlEntityError(err) {
  const code = err && err.code ? err.code : 'pbx_xml_entities_error';
  return { code, httpStatus: XML_ENTITY_ERROR_STATUS[code] || 500 };
}

function xmlEntityErrorMessage(err, code) {
  if (code === 'pbx_xml_dir_not_configured') {
    // O frontend (pbxLegacy.js) trata este code como estado esperado e exibe
    // orientação de configuração; manter message igual ao code por compatibilidade.
    return 'pbx_xml_dir_not_configured';
  }
  return (err && err.message) || 'Erro ao manipular entidade XML do PBX legado';
}

module.exports = { handlePbxLegacyRoutes };
