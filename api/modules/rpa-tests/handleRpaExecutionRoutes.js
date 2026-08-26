const {
  ensureSupportAccess,
  ensureRpaDevelopmentAccess,
  getPathSuffix,
  getExecutionIdFromActionPath,
  resolveRequestTenant,
} = require('./rpaRouteUtils');

async function handleRpaExecutionRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    executeRecording,
    getExecutionStatus,
    cancelExecution,
    continueExecution,
    nextStep,
  } = deps;

  if (method === 'POST' && pathname.startsWith('/rpa/execute/')) {
    if (!ensureRpaDevelopmentAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const recordingId = getPathSuffix(pathname, '/rpa/execute/');
      if (!recordingId) {
        badRequest(res, 'ID da gravação é obrigatório');
        return true;
      }

      const body = await parseJsonBody(req);
      const config = body.config || {};
      const data = body.data || {};
      const token = req.token || null;
      const actor = req.agent
        ? { agentId: req.agent.id || null, username: req.agent.username || null, role: req.agent.role || null }
        : null;

      const result = await executeRecording(recordingId, config, data, token, tenantId, actor);
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao executar RPA:', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao executar RPA',
      });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/rpa/execution/')) {
    if (!ensureSupportAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    try {
      const executionId = getPathSuffix(pathname, '/rpa/execution/');
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      const status = getExecutionStatus(executionId, tenantId);
      if (!status) {
        sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
        return true;
      }

      sendJson(res, 200, status);
    } catch (error) {
      logger.error('Erro ao obter status da execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter status' });
    }
    return true;
  }

  if (method === 'POST' && pathname.includes('/rpa/execution/') && pathname.endsWith('/cancel')) {
    if (!ensureRpaDevelopmentAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    try {
      const executionId = getExecutionIdFromActionPath(pathname);
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      const result = await cancelExecution(executionId, tenantId);
      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return true;
      }

      sendJson(res, 200, { success: true, message: 'Execução cancelada' });
    } catch (error) {
      logger.error('Erro ao cancelar execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao cancelar execução' });
    }
    return true;
  }

  if (method === 'POST' && pathname.includes('/rpa/execution/') && pathname.endsWith('/continue')) {
    if (!ensureRpaDevelopmentAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    try {
      const executionId = getExecutionIdFromActionPath(pathname);
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      const result = continueExecution(executionId, true, tenantId);
      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return true;
      }

      sendJson(res, 200, { success: true, message: 'Execução continuada sem pausas' });
    } catch (error) {
      logger.error('Erro ao continuar execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao continuar execução' });
    }
    return true;
  }

  if (method === 'POST' && pathname.includes('/rpa/execution/') && pathname.endsWith('/next')) {
    if (!ensureRpaDevelopmentAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    try {
      const executionId = getExecutionIdFromActionPath(pathname);
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      const result = nextStep(executionId, tenantId);
      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return true;
      }

      sendJson(res, 200, { success: true, message: 'Próximo step executado' });
    } catch (error) {
      logger.error('Erro ao executar próximo step RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar próximo step' });
    }
    return true;
  }

  if (method === 'GET' && pathname.includes('/rpa/execution/') && pathname.endsWith('/report')) {
    if (!ensureSupportAccess(req, res, requireAuth, sendJson)) return true;
    const tenantId = resolveRequestTenant(req, res, sendJson);
    if (!tenantId) return true;

    try {
      const executionId = getExecutionIdFromActionPath(pathname);
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      const status = getExecutionStatus(executionId, tenantId);
      if (!status) {
        sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
        return true;
      }

      sendJson(res, 200, {
        executionId: status.id,
        recordingId: status.recordingId,
        status: status.status,
        startTime: status.startTime,
        endTime: status.endTime,
        results: status.results,
      });
    } catch (error) {
      logger.error('Erro ao obter relatório da execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter relatório' });
    }
    return true;
  }

  return false;
}

module.exports = { handleRpaExecutionRoutes };
