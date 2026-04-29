'use strict';

const express = require('express');

function createQaWavesRoutes({ buildDeps }) {
  const router = express.Router();

  function registerJsonPost(pathname, handler) {
    router.post(pathname, async (req, res) => {
      const deps = buildDeps(req, res);
      const auth = deps.requireAuth(req);
      if (!auth.valid) {
        deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
        return;
      }

      if (!deps.hasJsonContentType(req)) {
        deps.badRequest(res, 'Content-Type deve ser application/json');
        return;
      }

      try {
        const body = await deps.parseJsonBody(req);
        const payload = await handler(deps, body || {}, req, res);
        if (payload && payload.__sent === true) return;
        deps.sendJson(res, 200, payload);
      } catch (error) {
        if (error.code === 'BAD_REQUEST') {
          deps.sendJson(res, 400, {
            error: 'bad_request',
            message: error.message,
            details: error.details || null,
          });
          return;
        }
        if (error.code === 'NOT_FOUND') {
          deps.sendJson(res, 404, { error: 'not_found', message: error.message });
          return;
        }
        deps.logger.error(`Erro ao processar ${pathname}:`, error);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisicao' });
      }
    });
  }

  router.get('/api/qa-waves/health', (req, res) => {
    const deps = buildDeps(req, res);
    deps.sendJson(res, 200, { status: 'ok', service: 'qa-waves' });
  });

  router.get('/api/qa-waves/waves', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      deps.sendJson(res, 200, { items: deps.listWaves() });
    } catch (error) {
      deps.logger.error('Erro ao listar waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar waves' });
    }
  });

  router.get('/api/qa-waves/scenarios', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      deps.sendJson(res, 200, deps.listWaveScenarios(req.query || {}));
    } catch (error) {
      deps.logger.error('Erro ao listar cenarios:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar cenarios' });
    }
  });

  router.get('/api/qa-waves/journeys', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      deps.sendJson(res, 200, deps.listJourneys());
    } catch (error) {
      deps.logger.error('Erro ao listar jornadas:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar jornadas' });
    }
  });

  router.get('/api/qa-waves/journey-status', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      deps.sendJson(res, 200, deps.listJourneyStatus());
    } catch (error) {
      deps.logger.error('Erro ao listar status de jornada:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar status de jornada' });
    }
  });

  router.get('/api/qa-waves/step-status', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      deps.sendJson(res, 200, deps.listStepStatus(req.query || {}));
    } catch (error) {
      deps.logger.error('Erro ao listar status de passos:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar status de passos' });
    }
  });

  router.get('/api/qa-waves/replays', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      const data = deps.listReplays(req.query || {});
      deps.sendJson(res, 200, data);
    } catch (error) {
      deps.logger.error('Erro ao listar replays:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar replays' });
    }
  });

  router.get('/api/qa-waves/replays/:id', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      const replay = deps.getReplayById(req.params.id);
      if (!replay) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Replay nao encontrado' });
        return;
      }
      deps.sendJson(res, 200, replay);
    } catch (error) {
      deps.logger.error('Erro ao detalhar replay:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao detalhar replay' });
    }
  });

  router.get('/api/qa-waves/executions', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      const limit = Number.parseInt(String(req.query?.limit || '20'), 10);
      const items = deps.listWaveExecutions(Number.isFinite(limit) ? limit : 20);
      deps.sendJson(res, 200, { items, count: items.length });
    } catch (error) {
      deps.logger.error('Erro ao listar execucoes QA Waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar execucoes QA Waves' });
    }
  });

  router.get('/api/qa-waves/executions/:executionId', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      const pollLog = {
        ts: Date.now(),
        iso: new Date().toISOString(),
        executionId: String(req.params.executionId || ''),
        tenantId: auth.agent?.tenantId || req.agent?.tenantId || null,
        agentId: auth.agent?.id || req.agent?.id || null,
      };
      deps.logger.info('[qa-waves-poll] request', pollLog);

      const execution = deps.getExecutionStatus(req.params.executionId);
      if (!execution) {
        deps.logger.info('[qa-waves-poll] not_found', pollLog);
        deps.sendJson(res, 404, { error: 'not_found', message: 'Execucao nao encontrada' });
        return;
      }

      deps.logger.info('[qa-waves-poll] response', {
        ...pollLog,
        status: execution.status || null,
        progress: execution.progress || 0,
      });

      deps.sendJson(res, 200, execution);
    } catch (error) {
      deps.logger.error('Erro ao obter status de execucao:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter status de execucao' });
    }
  });

  router.post('/api/qa-waves/executions', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    const perm = deps.requirePermission(req, 'qa', 'execute');
    if (!perm.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: perm.error });
      return;
    }

    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const execution = deps.queueWaveExecution(body || {});
      deps.sendJson(res, 202, execution);
    } catch (error) {
      if (error.code === 'BAD_REQUEST') {
        deps.badRequest(res, error.message);
        return;
      }
      deps.logger.error('Erro ao enfileirar execucao de wave:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao enfileirar execucao' });
    }
  });

  router.post('/api/qa-waves/replays/:id/reexecute', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    const perm = deps.requirePermission(req, 'qa', 'execute');
    if (!perm.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: perm.error });
      return;
    }

    try {
      const result = deps.reexecuteReplay(req.params.id);
      deps.sendJson(res, 202, result);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        deps.sendJson(res, 404, { error: 'not_found', message: error.message });
        return;
      }
      deps.logger.error('Erro ao reexecutar replay:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao reexecutar replay' });
    }
  });

  registerJsonPost('/api/qa-waves/infer-scenario', async (deps, body) => {
    return deps.inferWaveScenario(body || {});
  });

  registerJsonPost('/dev/qa-waves/infer-scenario', async (deps, body) => {
    return deps.inferWaveScenario(body || {});
  });

  registerJsonPost('/api/qa-waves/generate-seeds', async (deps, body) => {
    return deps.generateWaveSeeds(body || {});
  });

  registerJsonPost('/dev/qa-waves/generate-seeds', async (deps, body) => {
    return deps.generateWaveSeeds(body || {});
  });

  registerJsonPost('/api/qa-waves/validate-scenario', async (deps, body) => {
    const result = deps.validateWaveScenario(body || {});
    return {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      normalizedScenario: result.normalizedScenario,
    };
  });

  registerJsonPost('/dev/qa-waves/validate-scenario', async (deps, body) => {
    const result = deps.validateWaveScenario(body || {});
    return {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      normalizedScenario: result.normalizedScenario,
    };
  });

  registerJsonPost('/api/qa-waves/save-scenario', async (deps, body) => {
    return deps.saveWaveScenario(body || {});
  });

  registerJsonPost('/dev/qa-waves/save-scenario', async (deps, body) => {
    return deps.saveWaveScenario(body || {});
  });

  registerJsonPost('/api/qa-waves/run', async (deps, body) => {
    return deps.runWaveScenario(body || {});
  });

  registerJsonPost('/dev/qa-waves/run', async (deps, body) => {
    return deps.runWaveScenario(body || {});
  });

  // ─── Intelligence & Coverage ──────────────────────────────────────────────

  router.get('/api/qa-waves/intelligence/coverage', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    try {
      const { vertical, journey } = req.query || {};
      const result = deps.getCoverageSummary({ vertical: vertical || null, journey: journey || null });
      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao obter cobertura:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao calcular cobertura' });
    }
  });

  registerJsonPost('/api/qa-waves/intelligence/analyze-gaps', async (deps, body) => {
    const { vertical, journey } = body;
    if (!vertical) {
      const err = new Error('vertical é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    const scenarios = await deps.listWaveScenarios({});
    const allScenarios = Array.isArray(scenarios?.items) ? scenarios.items : (Array.isArray(scenarios) ? scenarios : []);
    return deps.analyzeWaveCoverageGaps({ vertical, journey: journey || null }, allScenarios);
  });

  registerJsonPost('/api/qa-waves/intelligence/generate-scenario', async (deps, body) => {
    const { vertical, journey, stage, gap, context } = body;
    if (!vertical || !journey || !stage || !gap) {
      const err = new Error('vertical, journey, stage e gap são obrigatórios');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return deps.generateWaveScenarioDraft({ vertical, journey, stage, gap, context: context || {} });
  });

  registerJsonPost('/api/qa-waves/intelligence/generate-seeds', async (deps, body) => {
    const { scenarioId, quantity, scenarioContext } = body;
    if (!scenarioId) {
      const err = new Error('scenarioId é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return deps.generateWaveSeedsForScenario({
      scenarioId,
      quantity: Number(quantity) || 5,
      scenarioContext: scenarioContext || {},
    });
  });

  registerJsonPost('/api/qa-waves/intelligence/approve-scenario', async (deps, body) => {
    const { draftId, approvedBy } = body;
    if (!draftId) {
      const err = new Error('draftId é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return deps.approveWaveDraft(draftId, { approvedBy: approvedBy || 'unknown' });
  });

  registerJsonPost('/api/qa-waves/intelligence/reject-scenario', async (deps, body) => {
    const { draftId, rejectedBy, reason } = body;
    if (!draftId) {
      const err = new Error('draftId é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return deps.rejectWaveDraft(draftId, { rejectedBy: rejectedBy || 'unknown', reason: reason || '' });
  });

  router.get('/api/qa-waves/intelligence/drafts', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    try {
      const { status, vertical, journey } = req.query || {};
      const drafts = deps.listWaveDrafts({ status: status || null, vertical: vertical || null, journey: journey || null });
      deps.sendJson(res, 200, { items: drafts, count: drafts.length });
    } catch (error) {
      deps.logger.error('Erro ao listar drafts de IA:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar drafts' });
    }
  });

  // ─── Governance ───────────────────────────────────────────────────────────

  router.get('/api/qa-waves/governance', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    try {
      const reports = deps.listWaveGovernanceReports();
      deps.sendJson(res, 200, { items: reports, count: reports.length });
    } catch (error) {
      deps.logger.error('Erro ao listar relatórios de governança:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar governança' });
    }
  });

  registerJsonPost('/api/qa-waves/governance/evaluate', async (deps, body) => {
    const { waveId, scenarioIds, policy } = body;
    if (!waveId) {
      const err = new Error('waveId é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    const scenarios = await deps.listWaveScenarios({});
    const allScenarios = Array.isArray(scenarios?.items) ? scenarios.items : (Array.isArray(scenarios) ? scenarios : []);
    const filtered = scenarioIds && Array.isArray(scenarioIds)
      ? allScenarios.filter((s) => scenarioIds.includes(s.id || s.scenarioId))
      : allScenarios;

    return deps.evaluateWaveGovernance({ waveId, scenarios: filtered, policy: policy || {} });
  });

  return router;
}

module.exports = {
  createQaWavesRoutes,
};
