'use strict';

const express = require('express');

function createOpsRoutes({ buildDeps }) {
  const router = express.Router();

  function requirePermissionGuard(req, res, deps, resource, action) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    const permResult = deps.requirePermission(req, resource, action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }
    return true;
  }

  router.get('/api/ops/event-ledger/metrics', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'analytics', 'read')) return;
    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const { getEventLedgerMetrics } = require('../../services/eventLedgerMetricsService');
      const result = await getEventLedgerMetrics({
        tenantId: req.tenantId,
        windowMinutes: urlObj.searchParams.get('windowMinutes') != null ? Number(urlObj.searchParams.get('windowMinutes')) : null,
      });
      if (!result.ok) {
        deps.sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'event_ledger_metrics_unavailable' });
        return;
      }
      deps.sendJson(res, 200, { ok: true, ...result.metrics, windowMinutes: result.windowMinutes });
    } catch (err) {
      deps.logger.error('[Ops] Erro ao obter métricas do event_ledger:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas do event_ledger' });
    }
  });

  router.get('/api/ops/flow-executions/metrics', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'analytics', 'read')) return;
    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const { getFlowExecutionLedgerMetrics } = require('../../services/flowExecutionLedgerMetricsService');
      const result = await getFlowExecutionLedgerMetrics({
        tenantId: req.tenantId,
        windowMinutes: urlObj.searchParams.get('windowMinutes') != null ? Number(urlObj.searchParams.get('windowMinutes')) : null,
      });
      if (!result.ok) {
        deps.sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'flow_execution_ledger_metrics_unavailable' });
        return;
      }
      deps.sendJson(res, 200, { ok: true, ...result.metrics, windowMinutes: result.windowMinutes });
    } catch (err) {
      deps.logger.error('[Ops] Erro ao obter métricas do execution ledger:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas do execution ledger' });
    }
  });

  async function sendExecutionQueueMetrics(req, res, deps, label) {
    try {
      const { getExecutionQueueMetrics } = require('../../services/executionQueueService');
      const result = await getExecutionQueueMetrics({ tenantId: req.tenantId });
      if (!result.ok) {
        deps.sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'queue_metrics_unavailable' });
        return;
      }
      deps.sendJson(res, 200, { ok: true, ...result.metrics });
    } catch (err) {
      deps.logger.error(label, err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas da execution queue' });
    }
  }

  router.get('/api/ops/execution-queue/metrics', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'analytics', 'read')) return;
    await sendExecutionQueueMetrics(req, res, deps, '[Ops] Erro ao obter métricas da execution queue (alias):');
  });

  router.get('/api/ops/execution-jobs/metrics', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'analytics', 'read')) return;
    await sendExecutionQueueMetrics(req, res, deps, '[Ops] Erro ao obter métricas da execution queue:');
  });

  router.get('/api/ops/execution-jobs/metrics-by-kind', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'analytics', 'read')) return;
    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const kinds = urlObj.searchParams.getAll('kind')
        .flatMap((k) => String(k || '').split(','))
        .map((k) => k.trim())
        .filter(Boolean);
      const { getExecutionQueueMetricsByKind } = require('../../services/executionQueueService');
      const result = await getExecutionQueueMetricsByKind({
        tenantId: req.tenantId,
        kinds: kinds.length ? kinds : null,
      });
      if (!result.ok) {
        deps.sendJson(res, 503, { error: 'service_unavailable', message: result.error || 'queue_metrics_unavailable' });
        return;
      }
      deps.sendJson(res, 200, { ok: true, items: result.items });
    } catch (err) {
      deps.logger.error('[Ops] Erro ao obter métricas por kind da execution queue:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter métricas por kind' });
    }
  });

  router.get('/api/ops/execution-jobs/dead', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'analytics', 'read')) return;
    try {
      const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
      const { listDeadJobs } = require('../../services/executionQueueService');
      const result = await listDeadJobs({
        tenantId: req.tenantId,
        kind: urlObj.searchParams.get('kind') ? String(urlObj.searchParams.get('kind')) : null,
        limit: urlObj.searchParams.get('limit') != null ? Number(urlObj.searchParams.get('limit')) : 100,
        offset: urlObj.searchParams.get('offset') != null ? Number(urlObj.searchParams.get('offset')) : 0,
      });
      deps.sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      deps.logger.error('[Ops] Erro ao listar DLQ da execution queue:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar DLQ da execution queue' });
    }
  });

  router.post('/api/ops/execution-jobs/retry', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!requirePermissionGuard(req, res, deps, 'config', 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const jobId = body && body.jobId ? String(body.jobId).trim() : '';
      if (!jobId) {
        deps.badRequest(res, 'Campo "jobId" é obrigatório');
        return;
      }
      const { retryDeadJob } = require('../../services/executionQueueService');
      const result = await retryDeadJob({ tenantId: req.tenantId, jobId });
      if (!result.ok) {
        if (result.error === 'dead_job_not_found') {
          deps.sendJson(res, 404, { error: 'job_not_found', message: 'Job DLQ não encontrado' });
          return;
        }
        deps.sendJson(res, 400, { error: 'bad_request', message: result.error || 'retry_failed' });
        return;
      }
      try {
        deps.logAction({
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
      deps.sendJson(res, 200, { ok: true, job: result.job });
    } catch (err) {
      deps.logger.error('[Ops] Erro ao reprocessar job DLQ:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao reprocessar job DLQ' });
    }
  });

  return router;
}

module.exports = {
  createOpsRoutes,
};
