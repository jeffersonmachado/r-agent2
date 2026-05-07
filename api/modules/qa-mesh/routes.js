'use strict';

const express = require('express');

function createQaMeshRoutes({ buildDeps }) {
  const router = express.Router();

  function ensureOperator(deps, req, res) {
    const perm = deps.requirePermission ? deps.requirePermission(req, 'qa', 'execute') : { allowed: false };
    const role = req.agent?.role;
    if (perm.allowed || role === 'admin' || role === 'supervisor') {
      return true;
    }
    deps.sendJson(res, 403, { error: 'forbidden', message: perm.error || 'Acesso restrito a admin/supervisor' });
    return false;
  }

  router.get('/qa-mesh/registry', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, { scenarios: deps.getRegistry() });
  });

  router.post('/qa-mesh/registry/refresh', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, { scenarios: deps.refreshMeshRegistry() });
  });

  router.get('/qa-mesh/latest', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    const latest = deps.getLatestExecution();
    if (!latest) {
      deps.sendJson(res, 404, { error: 'not_found', message: 'Nenhuma execução disponível' });
      return;
    }
    deps.sendJson(res, 200, latest);
  });

  router.get('/qa-mesh/history', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    const limit = Number.parseInt(req.query.limit || '20', 10);
    const domain = req.query.domain || undefined;
    const officialOnly = ['1', 'true', 'yes'].includes(String(req.query.officialOnly || '').toLowerCase());
    const results = deps.getMeshHistory({ limit, domain, officialOnly });
    deps.sendJson(res, 200, { results, count: results.length });
  });

  router.get('/qa-mesh/official-reference', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    const reference = deps.getOfficialReference();
    if (!reference) {
      deps.sendJson(res, 404, { error: 'not_found', message: 'Nenhuma referência oficial disponível' });
      return;
    }
    deps.sendJson(res, 200, reference);
  });

  router.get('/qa-mesh/scheduler', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getMeshSchedulerStatus());
  });

  router.get('/qa/stability', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getStabilitySnapshot());
  });

  router.get('/qa/stability/history', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getStabilityHistory());
  });

  router.get('/qa/stability/failures', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getStabilityFailures());
  });

  router.get('/qa/checkpoints', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getCheckpointsOverview());
  });

  router.get('/qa/checkpoints/:wave', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    const data = deps.getCheckpointByWaveId(req.params.wave);
    if (!data) {
      deps.sendJson(res, 404, { error: 'not_found', message: 'Checkpoint nao encontrado' });
      return;
    }
    deps.sendJson(res, 200, data);
  });

  router.get('/qa/learn/summary', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getLearnSummary());
  });

  router.get('/qa/learn/failures', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getLearnFailures());
  });

  router.get('/qa/learn/suggestions', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getLearnSuggestions());
  });

  router.get('/qa/learn/plans', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getLearnPlans());
  });

  router.get('/qa/learn/memory', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    deps.sendJson(res, 200, deps.getLearnMemory());
  });

  router.get('/qa-mesh/executions/:id', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    const execution = deps.getExecutionById(req.params.id);
    if (!execution) {
      deps.sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
      return;
    }
    deps.sendJson(res, 200, execution);
  });

  router.get('/qa-mesh/execution/:id/status', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    const execution = deps.getQueuedExecutionStatus(req.params.id);
    if (!execution) {
      deps.sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
      return;
    }
    deps.sendJson(res, 200, execution);
  });

  router.post('/qa-mesh/run', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!ensureOperator(deps, req, res)) {
      return;
    }
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const result = deps.queueMeshRun(body || {});
      deps.sendJson(res, 202, result);
    } catch (error) {
      if (error.code === 'EXECUTION_ALREADY_RUNNING') {
        deps.sendJson(res, 409, { error: 'execution_already_running', message: error.message, activeExecutionId: error.activeExecutionId || null });
        return;
      }
      deps.logger.error('Erro ao executar qa-mesh:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: error.message || 'Erro ao executar qa-mesh' });
    }
  });

  router.post('/qa-mesh/replay/:scenarioId', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!ensureOperator(deps, req, res)) {
      return;
    }
    try {
      const result = deps.queueScenarioReplay(req.params.scenarioId);
      deps.sendJson(res, 202, result);
    } catch (error) {
      if (error.code === 'EXECUTION_ALREADY_RUNNING') {
        deps.sendJson(res, 409, { error: 'execution_already_running', message: error.message, activeExecutionId: error.activeExecutionId || null });
        return;
      }
      if (error.code === 'PIPELINE_REQUIRED') {
        deps.sendJson(res, 409, { error: 'pipeline_required', message: error.message });
        return;
      }
      deps.logger.error('Erro no replay do qa-mesh:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: error.message || 'Erro ao reproduzir cenário' });
    }
  });

  return router;
}

module.exports = {
  createQaMeshRoutes,
};
