'use strict';

const service = require('../../services/durableProcessService');

module.exports = { handleProcessRuntimeControlRoutes };

async function handleProcessRuntimeControlRoutes({ req, res, method, pathname, deps }) {
  const {
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  if (method === 'POST' && pathname === '/api/process-runtime/start') {
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
      const out = await service.startDurableProcess({
        tenantId,
        processId: body?.processId || body?.flowId || null,
        processDefinition: body?.processDefinition || body?.definition || null,
        input: body?.input || {},
      });
      if (!out.ok) {
        sendJson(res, 400, { error: out.error || 'durable_start_failed', message: out.error || 'Não foi possível iniciar o processo' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[ProcessRuntime] Erro ao iniciar processo:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao iniciar processo' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/process-runtime/analytics') {
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const processId = urlObj.searchParams.get('processId');
      if (!processId) {
        badRequest(res, 'processId é obrigatório');
        return true;
      }
      const limit = urlObj.searchParams.get('limit');
      const out = await service.getProcessAnalytics({
        tenantId,
        processId: String(processId),
        limit: limit != null ? Number(limit) : 500,
      });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[ProcessRuntime] Erro ao calcular analytics:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao calcular analytics' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/process-runtime/simulate') {
    const permResult = requirePermission(req, 'analytics', 'read');
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
      const out = await service.simulateProcessDefinition({
        tenantId,
        processId: body?.processId || body?.flowId || null,
        processDefinition: body?.processDefinition || body?.definition || null,
        processVersion: body?.processVersion || null,
      });
      if (!out.ok) {
        sendJson(res, 400, { error: out.error || 'simulation_failed', message: out.error || 'Não foi possível simular o processo' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[ProcessRuntime] Erro ao simular processo:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao simular processo' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/process-runtime/intelligence') {
    const permResult = requirePermission(req, 'analytics', 'read');
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
      const out = await service.getProcessIntelligence({
        tenantId,
        processId: body?.processId || body?.flowId || null,
        processDefinition: body?.processDefinition || body?.definition || null,
        processVersion: body?.processVersion || null,
      });
      if (!out.ok) {
        sendJson(res, 400, { error: out.error || 'intelligence_failed', message: out.error || 'Não foi possível analisar o processo' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[ProcessRuntime] Erro ao gerar intelligence:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao gerar intelligence' });
    }
    return true;
  }

  return false;
}
