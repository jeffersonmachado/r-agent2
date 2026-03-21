'use strict';

async function handlePublicRuntimeRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, logger, requireAuth } = deps;

  if (method === 'GET' && pathname === '/system/status') {
    try {
      const { checkServicesStatus } = require('../../services/systemStatusService');
      const status = await checkServicesStatus();

      try {
        const executionIdHeader = (req.headers && (req.headers['x-execution-id'] || req.headers['x-pipeline-execution-id'])) || null;
        const executionId = (typeof executionIdHeader === 'string' && executionIdHeader.trim()) ? executionIdHeader.trim() : null;
        const isValidExecutionId = !!(executionId && executionId.length <= 96 && /^exec-[a-zA-Z0-9-]+$/.test(executionId));
        if (isValidExecutionId) {
          const authResult = requireAuth(req);
          if (authResult.valid && authResult.agent?.tenantId) {
            const tenantId = String(authResult.agent.tenantId);
            const ragService = status?.services?.ragService || null;
            if (ragService && ragService.status === 'healthy') {
              const { emitEvent } = require('../../services/websocketService');
              emitEvent('pipeline.status', {
                executionId,
                status: 'running',
                stages: { ragValidated: true },
                metadata: { message: 'Serviço RAG validado', source: '/system/status' },
              }, { tenantId });
            }
          }
        }
      } catch (_) {}

      sendJson(res, 200, status);
    } catch (err) {
      logger.error('Erro ao verificar status dos serviços:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao verificar status dos serviços',
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/system/websocket') {
    try {
      const { getConnectionsInfo } = require('../../services/websocketService');
      sendJson(res, 200, getConnectionsInfo());
    } catch (err) {
      logger.error('Erro ao obter informações de WebSocket:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao obter informações de WebSocket',
      });
    }
    return true;
  }

  return false;
}

module.exports = { handlePublicRuntimeRoutes };
