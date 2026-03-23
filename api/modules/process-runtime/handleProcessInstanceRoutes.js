'use strict';

const service = require('../../services/durableProcessService');

module.exports = { handleProcessInstanceRoutes };

async function handleProcessInstanceRoutes({ req, res, method, pathname, deps }) {
  const {
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (method === 'GET' && pathname === '/api/process-instances') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const status = urlObj.searchParams.get('status');
      const processId = urlObj.searchParams.get('processId');
      const limit = urlObj.searchParams.get('limit');
      const out = await service.listProcessInstances({
        tenantId,
        status: status ? String(status) : null,
        processId: processId ? String(processId) : null,
        limit: limit != null ? Number(limit) : 50,
      });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[ProcessRuntime] Erro ao listar instâncias:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar instâncias' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/process-instances/resume/external') {
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const body = await parseJsonBody(req);
      const correlationKey = body?.correlationKey ? String(body.correlationKey).trim() : '';
      if (!correlationKey) {
        badRequest(res, 'correlationKey é obrigatório');
        return true;
      }
      const out = await service.resumeExternalProcessEvent(correlationKey, body?.payload || {}, tenantId);
      if (!out.ok) {
        sendJson(res, 404, { error: out.error || 'resume_external_failed', message: out.error || 'Instância não encontrada' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[ProcessRuntime] Erro ao retomar evento externo:', err);
      sendJson(res, 400, { error: err.code || 'resume_external_failed', message: err.message || 'Erro ao retomar evento externo' });
    }
    return true;
  }

  if (pathname.startsWith('/api/process-instances/')) {
    const remainder = pathname.slice('/api/process-instances/'.length);
    const segments = remainder.split('/').filter(Boolean);
    const executionId = decodeURIComponent(segments[0] || '');
    if (!executionId) {
      sendJson(res, 400, { error: 'bad_request', message: 'executionId obrigatório' });
      return true;
    }

    if (method === 'GET' && segments.length === 1) {
      const permResult = requirePermission(req, 'analytics', 'read');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error });
        return true;
      }
      try {
        const tenantId = requireTenant(req, res);
        if (!tenantId) return true;
        const out = await service.getProcessInstance(executionId, tenantId);
        if (!out.ok) {
          sendJson(res, 404, { error: 'not_found', message: 'Instância não encontrada' });
          return true;
        }
        sendJson(res, 200, out);
      } catch (err) {
        logger.error('[ProcessRuntime] Erro ao inspecionar instância:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao inspecionar instância' });
      }
      return true;
    }

    if (method === 'GET' && segments[1] === 'history') {
      const permResult = requirePermission(req, 'analytics', 'read');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error });
        return true;
      }
      try {
        const tenantId = requireTenant(req, res);
        if (!tenantId) return true;
        const urlObj = new URL(req.url || '/', 'http://localhost');
        const eventType = urlObj.searchParams.get('eventType');
        const nodeId = urlObj.searchParams.get('nodeId');
        const limit = urlObj.searchParams.get('limit');
        const out = await service.getProcessInstanceHistory(executionId, tenantId, {
          eventType: eventType ? String(eventType) : null,
          nodeId: nodeId ? String(nodeId) : null,
          limit: limit != null ? Number(limit) : null,
        });
        if (!out.ok) {
          sendJson(res, 404, { error: 'not_found', message: 'Instância não encontrada' });
          return true;
        }
        sendJson(res, 200, { ok: true, history: out.history });
      } catch (err) {
        logger.error('[ProcessRuntime] Erro ao obter histórico:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter histórico' });
      }
      return true;
    }

    if (method === 'POST' && segments[1] === 'cancel') {
      const permResult = requirePermission(req, 'config', 'update');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error });
        return true;
      }
      if (!hasJsonContentType(req)) {
        badRequest(res, 'Content-Type deve ser application/json');
        return true;
      }
      try {
        const tenantId = requireTenant(req, res);
        if (!tenantId) return true;
        const body = await parseJsonBody(req);
        const out = await service.cancelProcessInstance(executionId, body?.reason || 'cancelled', {
          actorId: req.agent?.id || null,
        }, tenantId);
        if (!out.ok) {
          sendJson(res, 404, { error: out.error || 'cancel_failed', message: out.error || 'Instância não encontrada' });
          return true;
        }
        sendJson(res, 200, out);
      } catch (err) {
        logger.error('[ProcessRuntime] Erro ao cancelar instância:', err);
        sendJson(res, 400, { error: err.code || 'cancel_failed', message: err.message || 'Erro ao cancelar instância' });
      }
      return true;
    }

    if (method === 'POST' && segments[1] === 'resume') {
      const permResult = requirePermission(req, 'config', 'update');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error });
        return true;
      }
      if (!hasJsonContentType(req)) {
        badRequest(res, 'Content-Type deve ser application/json');
        return true;
      }
      try {
        const tenantId = requireTenant(req, res);
        if (!tenantId) return true;
        const body = await parseJsonBody(req);
        const out = await service.resumeProcessInstance(executionId, body?.payload || body || {}, tenantId);
        if (!out.ok) {
          sendJson(res, 404, { error: out.error || 'resume_failed', message: out.error || 'Instância não encontrada' });
          return true;
        }
        sendJson(res, 200, out);
      } catch (err) {
        logger.error('[ProcessRuntime] Erro ao retomar instância:', err);
        sendJson(res, 400, { error: err.code || 'resume_failed', message: err.message || 'Erro ao retomar instância' });
      }
      return true;
    }
  }

  return false;
}
