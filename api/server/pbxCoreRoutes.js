'use strict';

const logger = require('../utils/logger');
const { queryLogs, logAction } = require('../services/auditService');

function ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action }) {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const permResult = requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }
  return true;
}

function getAuditActor(req) {
  return {
    id: req.user?.id || req.agent?.id || null,
    username: req.user?.username || req.agent?.username || null,
  };
}

function getRequestIp(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

async function handlePbxCoreRoutes({
  req,
  res,
  url,
  method,
  pathname,
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
  requireAuth,
  requirePermission,
  requireTenant,
  buildApiError,
}) {
  if (!pathname.startsWith('/api/pbx/')) {
    return false;
  }

  if (method === 'GET' && pathname === '/api/pbx/extensions') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const pbxExtensions = require('../services/pbx/pbxExtensionsService');
      sendJson(res, 200, { items: await pbxExtensions.listExtensions({ tenantKey }) });
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

  if (method === 'POST' && pathname === '/api/pbx/extensions') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const pbxExtensions = require('../services/pbx/pbxExtensionsService');
      const { id: actorUserId, username } = getAuditActor(req);
      const item = await pbxExtensions.upsertExtension({ tenantKey, payload: body, actorUserId });
      try {
        logAction({
          agentId: actorUserId,
          username,
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
          ipAddress: getRequestIp(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_extensions_upsert_error';
      const httpStatus = ['extension_required', 'invalid_mac', 'invalid_provisioning_vendor', 'invalid_provisioning_settings_key', 'provisioning_mac_required', 'mac_already_assigned', 'weak_extension_password', 'provisioning_extension_inactive'].includes(code) ? 400 : 500;
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

  if (method === 'POST' && pathname === '/api/pbx/extensions/bulk') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
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
      const { id: actorUserId, username } = getAuditActor(req);
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
          agentId: actorUserId,
          username,
          tenantId: tenantKey,
          action: 'pbx.extensions.bulk',
          resource: 'pbx_extension',
          resourceId: null,
          details: { total: results.length, okCount, errorCount: results.length - okCount },
          ipAddress: getRequestIp(req),
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

  if (method === 'GET' && pathname === '/api/pbx/provisioning-token') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
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

  if (method === 'POST' && pathname === '/api/pbx/provisioning-token/rotate') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
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
          ipAddress: getRequestIp(req),
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

  if (method === 'POST' && pathname === '/api/pbx/provisioning-token/revoke') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
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
          ipAddress: getRequestIp(req),
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

  if (method === 'GET' && pathname === '/api/pbx/audit') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const rawHours = Number(urlObj.searchParams.get('hours') || 72);
      const rawLimit = Number(urlObj.searchParams.get('limit') || 300);
      const hours = Number.isFinite(rawHours) ? Math.max(1, Math.min(24 * 30, Math.floor(rawHours))) : 72;
      const limit = Number.isFinite(rawLimit) ? Math.max(10, Math.min(1000, Math.floor(rawLimit))) : 300;
      const startDate = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
      const result = await queryLogs({ tenantId: tenantKey, startDate, limit, offset: 0 });
      const pbxItems = (result?.items || []).filter((item) => String(item?.action || '').startsWith('pbx.'));
      const byAction = {};
      for (const item of pbxItems) {
        const action = String(item?.action || 'unknown');
        byAction[action] = (byAction[action] || 0) + 1;
      }
      sendJson(res, 200, { ok: true, hours, total: pbxItems.length, byAction, items: pbxItems });
    } catch (err) {
      logger.error('[PBX] Erro em GET /api/pbx/audit', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao consultar auditoria PBX' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/pbx/acls') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const pbxAcls = require('../services/pbx/pbxAclsService');
      sendJson(res, 200, { items: await pbxAcls.listAcls({ tenantKey }) });
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

  if (method === 'POST' && pathname === '/api/pbx/acls') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const pbxAcls = require('../services/pbx/pbxAclsService');
      const { id: actorUserId, username } = getAuditActor(req);
      const item = await pbxAcls.upsertAcl({ tenantKey, payload: body, actorUserId });
      try {
        logAction({
          agentId: actorUserId,
          username,
          tenantId: tenantKey,
          action: 'pbx.acls.upsert',
          resource: 'pbx_acl',
          resourceId: item?.id || null,
          details: { id: item?.id || null, name: item?.name || null, enabled: item?.enabled ? true : false },
          ipAddress: getRequestIp(req),
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

  if (method === 'DELETE' && pathname === '/api/pbx/acls') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const id = new URL(req.url || '/', 'http://localhost').searchParams.get('id');
      const pbxAcls = require('../services/pbx/pbxAclsService');
      const { id: actorUserId } = getAuditActor(req);
      const result = await pbxAcls.deleteAcl({ tenantKey, id, actorUserId });
      sendJson(res, 200, { ok: true, ...result });
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

  if (method === 'GET' && pathname === '/api/pbx/trunks') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const pbxTrunks = require('../services/pbx/pbxTrunksService');
      sendJson(res, 200, { items: await pbxTrunks.listTrunks({ tenantKey }) });
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

  if (method === 'POST' && pathname === '/api/pbx/trunks') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const pbxTrunks = require('../services/pbx/pbxTrunksService');
      const { id: actorUserId } = getAuditActor(req);
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

  if (method === 'GET' && pathname === '/api/pbx/routes') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const pbxRoutes = require('../services/pbx/pbxRoutesService');
      const direction = url.searchParams.get('direction');
      sendJson(res, 200, { items: await pbxRoutes.listRoutes({ tenantKey, direction: direction || null }) });
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

  if (method === 'POST' && pathname === '/api/pbx/routes') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const pbxRoutes = require('../services/pbx/pbxRoutesService');
      const { id: actorUserId } = getAuditActor(req);
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

  if (method === 'GET' && pathname === '/api/pbx/dids') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const pbxDids = require('../services/pbx/pbxDidsService');
      sendJson(res, 200, { items: await pbxDids.listDids({ tenantKey }) });
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

  if (method === 'POST' && pathname === '/api/pbx/dids') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const pbxDids = require('../services/pbx/pbxDidsService');
      const { id: actorUserId } = getAuditActor(req);
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

  if (method === 'GET' && pathname === '/api/pbx/call-rules') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const type = new URL(req.url || '/', 'http://localhost').searchParams.get('type');
      const pbxRules = require('../services/pbx/pbxCallRulesService');
      sendJson(res, 200, { items: await pbxRules.listCallRules({ tenantKey, type }) });
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

  if (method === 'POST' && pathname === '/api/pbx/call-rules') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const pbxRules = require('../services/pbx/pbxCallRulesService');
      const { id: actorUserId } = getAuditActor(req);
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

  if (method === 'GET' && pathname === '/api/pbx/queues') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const pbxQueues = require('../services/pbx/pbxQueuesService');
      sendJson(res, 200, { items: await pbxQueues.listQueues({ tenantKey }) });
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

  if (method === 'GET' && pathname === '/api/pbx/queues/metrics') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const pbxQueues = require('../services/pbx/pbxQueuesService');
      sendJson(res, 200, { ok: true, items: await pbxQueues.getQueueOperationalMetrics({ tenantKey }) });
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

  if (method === 'POST' && pathname === '/api/pbx/queues') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const pbxQueues = require('../services/pbx/pbxQueuesService');
      const { id: actorUserId } = getAuditActor(req);
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

  if (method === 'POST' && pathname === '/api/pbx/dialplan/preview') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
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

  if (method === 'POST' && pathname === '/api/pbx/dialplan/apply') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const pbxDialplan = require('../services/pbx/pbxDialplanService');
      const rows = await pbxDialplan.buildTenantDialplanRows({ tenantKey });
      const result = await pbxDialplan.applyTenantDialplanRows({ tenantKey, rows });
      const signature = pbxDialplan.computeDialplanSignature(rows);
      try {
        const pbxVersions = require('../services/pbx/pbxConfigVersionsService');
        const actorUserId = req.agent?.id || req.agent?.username || null;
        await pbxVersions.createVersion({
          tenantKey,
          status: 'applied',
          createdByUserId: actorUserId,
          summary: {
            appliedAt: new Date().toISOString(),
            dialplan: { count: rows.length, signature: signature || null, rows },
          },
        });
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
      try {
        const pbxVersions = require('../services/pbx/pbxConfigVersionsService');
        const actorUserId = req.agent?.id || req.agent?.username || null;
        await pbxVersions.createVersion({
          tenantKey,
          status: 'failed',
          createdByUserId: actorUserId,
          summary: { failedAt: new Date().toISOString(), error: err && err.message ? String(err.message) : 'apply_failed' },
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

  if (method === 'GET' && pathname === '/api/pbx/config-versions') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const limit = new URL(req.url || '/', 'http://localhost').searchParams.get('limit') || '20';
      const pbxVersions = require('../services/pbx/pbxConfigVersionsService');
      sendJson(res, 200, { ok: true, items: await pbxVersions.listVersions({ tenantKey, limit }) });
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

  if (method === 'POST' && pathname === '/api/pbx/dialplan/rollback') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const version = Number(new URL(req.url || '/', 'http://localhost').searchParams.get('version'));
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
          dialplan: { count: rows.length, signature, rows },
        },
      });
      try {
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

  if (method === 'POST' && pathname === '/api/pbx/reload') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
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

  if (method === 'GET' && pathname === '/api/pbx/queue-members') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'read' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const queueId = new URL(req.url || '/', 'http://localhost').searchParams.get('queueId');
      if (!queueId) {
        sendJson(res, 400, { error: 'bad_request', message: 'queueId obrigatório' });
        return true;
      }
      const pbxQueueMembers = require('../services/pbx/pbxQueueMembersService');
      sendJson(res, 200, { items: await pbxQueueMembers.listQueueMembers({ tenantKey, queueId: String(queueId) }) });
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

  if (method === 'POST' && pathname === '/api/pbx/queue-members') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const pbxQueueMembers = require('../services/pbx/pbxQueueMembersService');
      const { id: actorUserId } = getAuditActor(req);
      const item = await pbxQueueMembers.upsertQueueMember({ tenantKey, payload: body, actorUserId });
      sendJson(res, 200, { ok: true, item });
    } catch (err) {
      const code = err.code || 'pbx_queue_members_upsert_error';
      const httpStatus = ['queue_id_required', 'member_type_invalid', 'member_ref_required', 'queue_not_found'].includes(code) ? 400 : 500;
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

  if (method === 'DELETE' && pathname === '/api/pbx/queue-members') {
    if (!ensureConfigAccess({ req, res, sendJson, requireAuth, requirePermission, action: 'update' })) return true;
    const tenantKey = requireTenant(req, res);
    if (!tenantKey) return true;
    try {
      const id = new URL(req.url || '/', 'http://localhost').searchParams.get('id');
      if (!id) {
        sendJson(res, 400, { error: 'bad_request', message: 'id obrigatório' });
        return true;
      }
      const pbxQueueMembers = require('../services/pbx/pbxQueueMembersService');
      const { id: actorUserId } = getAuditActor(req);
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

  return false;
}

module.exports = {
  handlePbxCoreRoutes,
};
