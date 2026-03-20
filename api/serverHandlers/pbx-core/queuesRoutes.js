async function handlePbxQueuesRoutes(ctx) {
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

  if (!pathname.startsWith('/api/pbx/queues') && pathname !== '/api/pbx/queue-members') {
    return false;
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
      const pbxQueues = require('../../services/pbx/pbxQueuesService');
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
      const pbxQueues = require('../../services/pbx/pbxQueuesService');
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
      const pbxQueues = require('../../services/pbx/pbxQueuesService');
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
      const pbxQueueMembers = require('../../services/pbx/pbxQueueMembersService');
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
      const pbxQueueMembers = require('../../services/pbx/pbxQueueMembersService');
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
      const pbxQueueMembers = require('../../services/pbx/pbxQueueMembersService');
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

  return false;
}

module.exports = { handlePbxQueuesRoutes };
