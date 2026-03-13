/**
 * Ops/Execution Queue Route Handler
 * Handles: Event metrics, execution queue metrics, DLQ operations
 */

async function handleOpsRoutes(ctx) {
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
  // Ops: Execution Queue (DLQ/metrics) - autenticado
  // -----------------------------------------------------------------------
  // GET /api/ops/event-ledger/metrics
  if (method === 'GET' && pathname === '/api/ops/event-ledger/metrics') {
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
      const windowMinutes = urlObj.searchParams.get('windowMinutes');
      const { getEventLedgerMetrics } = require('../services/eventLedgerMetricsService');
      const result = await getEventLedgerMetrics({
        tenantId: req.tenantId,
        windowMinutes: windowMinutes != null ? Number(windowMinutes) : null,
      });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'event_ledger_metrics_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, ...result.metrics, windowMinutes: result.windowMinutes });
    } catch (err) {
      logger.error('[Ops] Erro ao obter métricas do event_ledger:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas do event_ledger' });
    }
    return true;
  }

  // GET /api/ops/flow-executions/metrics
  if (method === 'GET' && pathname === '/api/ops/flow-executions/metrics') {
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
      const windowMinutes = urlObj.searchParams.get('windowMinutes');
      const { getFlowExecutionLedgerMetrics } = require('../services/flowExecutionLedgerMetricsService');
      const result = await getFlowExecutionLedgerMetrics({
        tenantId: req.tenantId,
        windowMinutes: windowMinutes != null ? Number(windowMinutes) : null,
      });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'flow_execution_ledger_metrics_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, ...result.metrics, windowMinutes: result.windowMinutes });
    } catch (err) {
      logger.error('[Ops] Erro ao obter métricas do execution ledger:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas do execution ledger' });
    }
    return true;
  }

  // GET /api/ops/execution-queue/metrics (alias de /api/ops/execution-jobs/metrics)
  if (method === 'GET' && pathname === '/api/ops/execution-queue/metrics') {
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
      const { getExecutionQueueMetrics } = require('../services/executionQueueService');
      const result = await getExecutionQueueMetrics({ tenantId: req.tenantId });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'queue_metrics_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, ...result.metrics });
    } catch (err) {
      logger.error('[Ops] Erro ao obter métricas da execution queue (alias):', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas da execution queue' });
    }
    return true;
  }

  // GET /api/ops/execution-jobs/metrics
  if (method === 'GET' && pathname === '/api/ops/execution-jobs/metrics') {
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
      const { getExecutionQueueMetrics } = require('../services/executionQueueService');
      const result = await getExecutionQueueMetrics({ tenantId: req.tenantId });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'queue_metrics_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, ...result.metrics });
    } catch (err) {
      logger.error('[Ops] Erro ao obter métricas da execution queue:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas da execution queue' });
    }
    return true;
  }

  // GET /api/ops/execution-jobs/metrics-by-kind?kind=...&kind=...
  if (method === 'GET' && pathname === '/api/ops/execution-jobs/metrics-by-kind') {
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
      const rawKinds = urlObj.searchParams.getAll('kind');
      const kinds = rawKinds
        .flatMap((k) => String(k || '').split(','))
        .map((k) => k.trim())
        .filter(Boolean);

      const { getExecutionQueueMetricsByKind } = require('../services/executionQueueService');
      const result = await getExecutionQueueMetricsByKind({
        tenantId: req.tenantId,
        kinds: kinds.length ? kinds : null,
      });
      if (!result.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'queue_metrics_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, items: result.items });
    } catch (err) {
      logger.error('[Ops] Erro ao obter métricas por kind da execution queue:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas por kind' });
    }
    return true;
  }

  // GET /api/ops/execution-jobs/dead?kind=&limit=&offset=
  if (method === 'GET' && pathname === '/api/ops/execution-jobs/dead') {
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
      const kind = urlObj.searchParams.get('kind');
      const limit = urlObj.searchParams.get('limit');
      const offset = urlObj.searchParams.get('offset');
      const { listDeadJobs } = require('../services/executionQueueService');
      const result = await listDeadJobs({
        tenantId: req.tenantId,
        kind: kind ? String(kind) : null,
        limit: limit != null ? Number(limit) : 100,
        offset: offset != null ? Number(offset) : 0,
      });
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      logger.error('[Ops] Erro ao listar DLQ da execution queue:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar DLQ da execution queue' });
    }
    return true;
  }

  // POST /api/ops/execution-jobs/retry { jobId }
  if (method === 'POST' && pathname === '/api/ops/execution-jobs/retry') {
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
      const body = await parseJsonBody(req);
      const jobId = body && body.jobId ? String(body.jobId).trim() : '';
      if (!jobId) {
        badRequest(res, 'Campo "jobId" é obrigatório');
        return true;
      }
      const { retryDeadJob } = require('../services/executionQueueService');
      const result = await retryDeadJob({ tenantId: req.tenantId, jobId });
      if (!result.ok) {
        if (result.error === 'dead_job_not_found') {
          sendJson(res, 404, { error: 'job_not_found', message: 'Job DLQ não encontrado' });
          return true;
        }
        sendJson(res, 400, { error: 'bad_request', message: result.error || 'retry_failed' });
        return true;
      }

      try {
        logAction({
          agentId: req.agent?.id || null,
          username: req.agent?.username || null,
          tenantId: req.tenantId,
          action: 'execution_job_retry',
          resource: 'execution_job',
          resourceId: jobId,
          details: { fromStatus: 'dead', toStatus: 'pending' },
          ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 200, { ok: true, job: result.job });
    } catch (err) {
      logger.error('[Ops] Erro ao reprocessar job DLQ:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao reprocessar job DLQ' });
    }
    return true;
  }

  // Not an ops route
  return false;
}

module.exports = { handleOpsRoutes };
