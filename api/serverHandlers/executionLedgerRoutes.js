/**
 * Execution Ledger Route Handler
 * Handles: Flow execution queries and replay operations
 */

async function handleExecutionLedgerRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
  } = deps;

  // -----------------------------------------------------------------------
  // Execution ledger (flow_executions/node_executions) - autenticado
  // -----------------------------------------------------------------------
  // GET /api/executions?correlationId=&sessionId=&subjectType=&subjectId=&limit=&offset=
  if (method === 'GET' && pathname === '/api/executions') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const correlationId = urlObj.searchParams.get('correlationId');
      const sessionId = urlObj.searchParams.get('sessionId');
      const subjectType = urlObj.searchParams.get('subjectType');
      const subjectId = urlObj.searchParams.get('subjectId');
      const limit = urlObj.searchParams.get('limit');
      const offset = urlObj.searchParams.get('offset');

      const { listFlowExecutions } = require('../services/flowExecutionLedgerService');
      const result = await listFlowExecutions({
        tenantId: req.tenantId,
        correlationId: correlationId ? String(correlationId) : null,
        sessionId: sessionId ? String(sessionId) : null,
        subjectType: subjectType ? String(subjectType) : null,
        subjectId: subjectId ? String(subjectId) : null,
        limit: limit != null ? Number(limit) : 50,
        offset: offset != null ? Number(offset) : 0,
      });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'execution_ledger_unavailable' });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('[ExecutionLedger] Erro ao listar execuções:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar execuções' });
    }
    return true;
  }

  // GET /api/executions/ledger (alias de /api/executions)
  if (method === 'GET' && pathname === '/api/executions/ledger') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const correlationId = urlObj.searchParams.get('correlationId');
      const sessionId = urlObj.searchParams.get('sessionId');
      const subjectType = urlObj.searchParams.get('subjectType');
      const subjectId = urlObj.searchParams.get('subjectId');
      const limit = urlObj.searchParams.get('limit');
      const offset = urlObj.searchParams.get('offset');

      const { listFlowExecutions } = require('../services/flowExecutionLedgerService');
      const result = await listFlowExecutions({
        tenantId: req.tenantId,
        correlationId: correlationId ? String(correlationId) : null,
        sessionId: sessionId ? String(sessionId) : null,
        subjectType: subjectType ? String(subjectType) : null,
        subjectId: subjectId ? String(subjectId) : null,
        limit: limit != null ? Number(limit) : 50,
        offset: offset != null ? Number(offset) : 0,
      });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'execution_ledger_unavailable' });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('[ExecutionLedger] Erro ao listar execuções (alias):', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar execuções' });
    }
    return true;
  }

  // GET /api/executions/:id
  if (method === 'GET' && pathname.startsWith('/api/executions/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    try {
      const execId = decodeURIComponent(pathname.slice('/api/executions/'.length));
      if (!execId || execId === 'ledger' || execId.includes('/')) {
        return false; // Not a match - pass to next handler
      }

      const { getFlowExecutionDetails } = require('../services/flowExecutionLedgerService');
      const result = await getFlowExecutionDetails({ tenantId: req.tenantId, executionId: execId });
      if (!result.ok) {
        if (result.error === 'execution_not_found') {
          sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
          return true;
        }
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'execution_ledger_unavailable' });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('[ExecutionLedger] Erro ao obter execução:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter execução' });
    }
    return true;
  }

  // POST /api/executions/:id/replay-from-node  { fromNodeExecutionId|fromStepIndex, maxSteps }
  if (method === 'POST' && pathname.startsWith('/api/executions/') && pathname.endsWith('/replay-from-node')) {
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
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const execId = decodeURIComponent(pathname.slice('/api/executions/'.length).replace(/\/replay-from-node$/, ''));
      const body = await parseJsonBody(req);
      const fromNodeExecutionId = body && body.fromNodeExecutionId ? String(body.fromNodeExecutionId).trim() : null;
      const fromStepIndex = body && body.fromStepIndex != null ? Number(body.fromStepIndex) : null;
      const maxSteps = body && body.maxSteps != null ? Number(body.maxSteps) : 200;

      const { replayFromNode } = require('../services/flowExecutionLedgerService');
      const result = await replayFromNode({
        tenantId: req.tenantId,
        executionId: execId,
        fromNodeExecutionId,
        fromStepIndex,
        maxSteps,
      });
      if (!result.ok) {
        const msgMap = {
          replay_disabled: 'Replay está desabilitado. Defina ENABLE_EXECUTION_LEDGER_REPLAY=true para habilitar.',
          replay_only_supported_for_simulation: 'Replay a partir do ledger só é suportado para execuções de simulação (meta.mode=simulation), a menos que ENABLE_EXECUTION_LEDGER_REPLAY_REAL=true esteja habilitado.',
          replay_execution_running: 'Replay não permitido para execuções em andamento. Aguarde a conclusão da execução.',
          replay_real_not_allowed: 'Replay real bloqueado por allowlist. Configure EXECUTION_LEDGER_REPLAY_REAL_ALLOWLIST_EXECUTIONS ou EXECUTION_LEDGER_REPLAY_REAL_ALLOWLIST_CORRELATIONS.',
          from_node_not_found: 'Node de origem não encontrado nesta execução.',
          replay_not_allowed_for_tenant: 'Replay não permitido para este tenant.',
        };
        sendJson(res, 400, { error: String(result.error || 'replay_failed'), message: msgMap[result.error] || 'Não foi possível executar replay' });
        return true;
      }

      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: req.tenantId,
          action: 'execution_replay_from_node',
          resource: 'flow_execution',
          resourceId: execId,
          details: { replayExecutionId: result.replayExecutionId, fromNodeExecutionId: fromNodeExecutionId || null, fromStepIndex: fromStepIndex != null ? fromStepIndex : null },
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('[ExecutionLedger] Erro ao executar replay-from-node:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar replay-from-node' });
    }
    return true;
  }

  // Not an execution ledger route
  return false;
}

module.exports = { handleExecutionLedgerRoutes };
