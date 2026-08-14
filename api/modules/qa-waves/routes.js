'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  buildQaWavesEnterpriseGovernance,
} = require('../../../tools/system/lib/qa-waves-enterprise-governance-bridge');
const { checkClassification } = require('../../middleware/requireClassification');
const { tenantFromRequest } = require('../../../lib/rpaSecurity');

const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const RUNTIME_GOVERNANCE_REPORT_PATH = process.env.RUNTIME_GOVERNANCE_REPORT_PATH || path.join(ROOT_DIR, 'qa', 'runtime-governance-report.json');
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || path.join(ROOT_DIR, 'qa', 'go-no-go-report.json');

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function createQaWavesRoutes({ buildDeps }) {
  const router = express.Router();

  // QA Waves é ferramenta de engenharia (PRODUCTION_HIDDEN): exige DEVELOPMENT.
  function enforceDevelopmentClassification(deps, req, res) {
    const check = checkClassification(req, 'DEVELOPMENT');
    if (!check.allowed) {
      deps.sendJson(res, 403, {
        error: 'classification_required',
        required: check.required,
        classification: check.classification,
      });
      return false;
    }
    return true;
  }

  function requireAuthenticatedTenant(deps, req, res, auth = null) {
    try {
      return tenantFromRequest(req, auth);
    } catch (error) {
      deps.sendJson(res, 400, {
        error: error.code === 'TENANT_INVALID' ? 'tenant_invalid' : 'tenant_required',
        message: 'Tenant autenticado é obrigatório para QA Waves',
      });
      return null;
    }
  }

  function enforceQaExecutePermission(deps, req, res) {
    const permission = deps.requirePermission(req, 'qa', 'execute');
    if (permission.allowed) return true;
    deps.sendJson(res, 403, { error: 'forbidden', message: permission.error });
    return false;
  }

  function enforceSystemTenant(deps, req, res, tenantId) {
    if (tenantId === 'system') return true;
    deps.sendJson(res, 403, {
      error: 'system_tenant_required',
      message: 'Esta operação altera ou expõe governança canônica global e exige o tenant system',
    });
    return false;
  }

  function registerJsonPost(pathname, handler) {
    router.post(pathname, async (req, res) => {
      const deps = buildDeps(req, res);
      const auth = deps.requireAuth(req);
      if (!auth.valid) {
        deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
        return;
      }
      if (!enforceDevelopmentClassification(deps, req, res)) return;
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      req.qaTenantId = tenantId;

      if (!enforceQaExecutePermission(deps, req, res)) return;

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
        if (error.code === 'CONFLICT') {
          deps.sendJson(res, 409, { error: 'conflict', message: error.message });
          return;
        }
        deps.logger.error(`Erro ao processar ${pathname}:`, error);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisicao' });
      }
    });
  }

  router.get('/api/qa-waves/health', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
    if (!tenantId) return;
    deps.sendJson(res, 200, { status: 'ok', service: 'qa-waves' });
  });

  router.get('/api/qa-waves/waves', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      deps.sendJson(res, 200, { items: deps.listWaves(tenantId) });
    } catch (error) {
      deps.logger.error('Erro ao listar waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar waves' });
    }
  });

  router.get('/api/qa-waves/coverage/summary', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      deps.sendJson(res, 200, deps.getWaveCoverageSummary(tenantId));
    } catch (error) {
      deps.logger.error('Erro ao obter resumo de cobertura:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao calcular resumo de cobertura' });
    }
  });

  router.get('/api/qa-waves/scenarios', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      deps.sendJson(res, 200, deps.listWaveScenarios({ ...(req.query || {}), tenantId }));
    } catch (error) {
      deps.logger.error('Erro ao listar cenarios:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar cenarios' });
    }
  });

  router.delete('/api/qa-waves/scenarios/:scenarioId', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    if (!enforceQaExecutePermission(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const result = deps.deleteWaveScenario(req.params.scenarioId, tenantId);
      deps.sendJson(res, 200, result);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        deps.sendJson(res, 404, { error: 'not_found', message: error.message });
        return;
      }
      if (error.code === 'BAD_REQUEST') {
        deps.sendJson(res, 400, { error: 'bad_request', message: error.message });
        return;
      }
      deps.logger.error('Erro ao deletar cenario:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao deletar cenario' });
    }
  });

  router.get('/api/qa-waves/journeys', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      deps.sendJson(res, 200, deps.listJourneys(tenantId));
    } catch (error) {
      deps.logger.error('Erro ao listar jornadas:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar jornadas' });
    }
  });

  router.post('/api/qa-waves/journeys', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    if (!enforceQaExecutePermission(deps, req, res)) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const result = deps.saveWaveJourney(body || {}, tenantId);
      deps.sendJson(res, 200, result);
    } catch (error) {
      if (error.code === 'BAD_REQUEST') {
        deps.sendJson(res, 400, { error: 'bad_request', message: error.message });
        return;
      }
      deps.logger.error('Erro ao salvar jornada:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar jornada' });
    }
  });

  router.delete('/api/qa-waves/journeys/:journeyId', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    if (!enforceQaExecutePermission(deps, req, res)) return;
    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const result = deps.deleteWaveJourney(req.params.journeyId, req.query.vertical, tenantId);
      deps.sendJson(res, 200, result);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        deps.sendJson(res, 404, { error: 'not_found', message: error.message });
        return;
      }
      if (error.code === 'BAD_REQUEST') {
        deps.sendJson(res, 400, { error: 'bad_request', message: error.message });
        return;
      }
      deps.logger.error('Erro ao deletar jornada:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao deletar jornada' });
    }
  });

  router.get('/api/qa-waves/journey-status', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      deps.sendJson(res, 200, deps.listJourneyStatus(tenantId));
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
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      deps.sendJson(res, 200, deps.listStepStatus({ ...(req.query || {}), tenantId }));
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
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const data = deps.listReplays({ ...(req.query || {}), tenantId });
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
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const replay = deps.getReplayById(req.params.id, tenantId);
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

  router.delete('/api/qa-waves/executions', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    if (!enforceQaExecutePermission(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const result = deps.clearWaveExecutions(tenantId);
      deps.sendJson(res, 200, { ...result, message: 'Estado terminal em memória limpo; evidências preservadas' });
    } catch (error) {
      deps.logger.error('Erro ao limpar execucoes QA Waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao limpar execucoes' });
    }
  });

  router.get('/api/qa-waves/executions', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const limit = Number.parseInt(String(req.query?.limit || '20'), 10);
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const items = deps.listWaveExecutions(Number.isFinite(limit) ? limit : 20, tenantId);
      deps.sendJson(res, 200, { items, count: items.length });
    } catch (error) {
      deps.logger.error('Erro ao listar execucoes QA Waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar execucoes QA Waves' });
    }
  });

  router.get('/api/qa-waves/executions/history', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const limit = Number.parseInt(String(req.query?.limit || '50'), 10);
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const history = deps.getWaveExecutionHistory(Number.isFinite(limit) ? limit : 50, tenantId);
      deps.sendJson(res, 200, history);
    } catch (error) {
      deps.logger.error('Erro ao consultar histórico imutável de execuções QA Waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao consultar histórico de execuções' });
    }
  });

  router.get('/api/qa-waves/executions/:executionId', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const pollLog = {
        ts: Date.now(),
        iso: new Date().toISOString(),
        executionId: String(req.params.executionId || ''),
        tenantId,
        agentId: auth.agent?.id || req.agent?.id || null,
      };
      deps.logger.info('[qa-waves-poll] request', pollLog);

      const execution = deps.getExecutionStatus(req.params.executionId, tenantId);
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
    if (!enforceDevelopmentClassification(deps, req, res)) return;

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
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const execution = deps.queueWaveExecution(body || {}, tenantId);
      if (deps.emitWavesEvent) {
        deps.emitWavesEvent('qa-waves.execution.started', {
          executionId: execution.executionId,
          scenarioIds: body?.scenarioIds || [],
        }, { tenantId });
      }
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
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    const perm = deps.requirePermission(req, 'qa', 'execute');
    if (!perm.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: perm.error });
      return;
    }

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const result = deps.reexecuteReplay(req.params.id, tenantId);
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

  async function handleInferScenario(deps, body, req, res) {
    try {
      return await deps.inferWaveScenario({
        ...(body || {}),
        tenantId: req.qaTenantId,
        agentId: req.agent?.id || null,
      });
    } catch (error) {
      if (error.code === 'AI_UNAVAILABLE') {
        deps.sendJson(res, 503, {
          error: 'ai_unavailable',
          message: 'Serviço de IA indisponível para inferência de jornada',
          detail: error.message,
        });
        return { __sent: true };
      }
      throw error;
    }
  }

  registerJsonPost('/api/qa-waves/infer-scenario', (deps, body, req, res) =>
    handleInferScenario(deps, body, req, res)
  );

  registerJsonPost('/dev/qa-waves/infer-scenario', (deps, body, req, res) =>
    handleInferScenario(deps, body, req, res)
  );

  registerJsonPost('/api/qa-waves/generate-seeds', async (deps, body, req) => {
    return deps.generateWaveSeeds({ ...(body || {}), tenantId: req.qaTenantId });
  });

  registerJsonPost('/dev/qa-waves/generate-seeds', async (deps, body, req) => {
    return deps.generateWaveSeeds({ ...(body || {}), tenantId: req.qaTenantId });
  });

  registerJsonPost('/api/qa-waves/validate-scenario', async (deps, body, req) => {
    const result = deps.validateWaveScenario({ ...(body || {}), tenantId: req.qaTenantId });
    return {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      normalizedScenario: result.normalizedScenario,
    };
  });

  registerJsonPost('/dev/qa-waves/validate-scenario', async (deps, body, req) => {
    const result = deps.validateWaveScenario({ ...(body || {}), tenantId: req.qaTenantId });
    return {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      normalizedScenario: result.normalizedScenario,
    };
  });

  registerJsonPost('/api/qa-waves/save-scenario', async (deps, body, req) => {
    return deps.saveWaveScenario({
      ...(body || {}),
      tenantId: req.qaTenantId,
      changedBy: req.agent?.id || req.agent?.username || 'qa_waves',
    });
  });

  registerJsonPost('/dev/qa-waves/save-scenario', async (deps, body, req) => {
    return deps.saveWaveScenario({
      ...(body || {}),
      tenantId: req.qaTenantId,
      changedBy: req.agent?.id || req.agent?.username || 'qa_waves',
    });
  });

  registerJsonPost('/api/qa-waves/run', async (deps, body, req) => {
    return deps.runWaveScenario({ ...(body || {}), tenantId: req.qaTenantId });
  });

  registerJsonPost('/dev/qa-waves/run', async (deps, body, req) => {
    return deps.runWaveScenario({ ...(body || {}), tenantId: req.qaTenantId });
  });

  // ─── Intelligence & Coverage ──────────────────────────────────────────────

  router.get('/api/qa-waves/intelligence/coverage', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    try {
      const { vertical, journey } = req.query || {};
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const result = deps.getCoverageSummary({ vertical: vertical || null, journey: journey || null, tenantId });
      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao obter cobertura:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao calcular cobertura' });
    }
  });

  registerJsonPost('/api/qa-waves/intelligence/analyze-gaps', async (deps, body, req) => {
    const { vertical, journey } = body;
    if (!vertical) {
      const err = new Error('vertical é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    const scenarios = await deps.listWaveScenarios({ tenantId: req.qaTenantId });
    const allScenarios = Array.isArray(scenarios?.items) ? scenarios.items : (Array.isArray(scenarios) ? scenarios : []);
    return deps.analyzeWaveCoverageGaps({ vertical, journey: journey || null, tenantId: req.qaTenantId }, allScenarios);
  });

  // ─── Vertical Review (botão "Revisar vertical") ────────────────────────────
  //
  // Orquestra o que o agente de IA fazia manualmente: discovery → inferência de
  // jornada → gaps de negócio/cobertura → geração de drafts por IA.
  // Nada é executado automaticamente; drafts entram como draft_ai.
  registerJsonPost('/api/qa-waves/vertical-review', async (deps, body, req) => {
    const { vertical } = body || {};
    if (!vertical) {
      const err = new Error('vertical é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return deps.reviewVertical({
      ...(body || {}),
      tenantId: req.qaTenantId,
    });
  });

  registerJsonPost('/dev/qa-waves/vertical-review', async (deps, body, req) => {
    const { vertical } = body || {};
    if (!vertical) {
      const err = new Error('vertical é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return deps.reviewVertical({
      ...(body || {}),
      tenantId: req.qaTenantId,
    });
  });

  // ─── Revisão de Jornada (fluxo interativo: inferir → ajustar → re-inferir →
  //      aprovar → atualizar) ────────────────────────────────────────────────
  registerJsonPost('/api/qa-waves/review-journey/infer', async (deps, body, req) => {
    return deps.reviewJourneyInfer({
      ...(body || {}),
      tenantId: req.qaTenantId,
      reviewedBy: req.agent?.id || req.agent?.username || '',
    });
  });

  registerJsonPost('/dev/qa-waves/review-journey/infer', async (deps, body, req) => {
    return deps.reviewJourneyInfer({
      ...(body || {}),
      tenantId: req.qaTenantId,
      reviewedBy: req.agent?.id || req.agent?.username || '',
    });
  });

  registerJsonPost('/api/qa-waves/review-journey/apply', async (deps, body, req) => {
    return deps.reviewJourneyApply({
      ...(body || {}),
      tenantId: req.qaTenantId,
      changedBy: req.agent?.id || req.agent?.username || '',
    });
  });

  registerJsonPost('/dev/qa-waves/review-journey/apply', async (deps, body, req) => {
    return deps.reviewJourneyApply({
      ...(body || {}),
      tenantId: req.qaTenantId,
      changedBy: req.agent?.id || req.agent?.username || '',
    });
  });

  // ─── Business Gaps ──────────────────────────────────────────────────────
  router.get('/api/qa-waves/intelligence/business-gaps', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    try {
      const { vertical, journey } = req.query || {};
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const result = deps.getBusinessGaps({ vertical: vertical || null, journey: journey || null, tenantId });
      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao obter business gaps:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter business gaps' });
    }
  });

  // ─── Docs (roteiros + diagramas) ───────────────────────────────────────
  router.get('/api/qa-waves/docs/:type', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    try {
      const docType = String(req.params.type || '').trim();
      const docName = typeof req.query.name === 'string' ? req.query.name.trim() : null;
      const allowedTypes = {
        roteiros: 'docs/roteiros',
        diagrams: 'docs/diagrams/qa-waves',
      };
      const baseDir = allowedTypes[docType];
      if (!baseDir) {
        deps.sendJson(res, 400, { error: 'bad_request', message: 'Tipo de documentação inválido' });
        return;
      }
      const fullPath = path.join(ROOT_DIR, baseDir);

      if (!fs.existsSync(fullPath)) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Diretório de documentação não encontrado' });
        return;
      }

      if (docName) {
        // Serve specific doc
        const filePath = path.resolve(fullPath, docName);
        const isDirectMarkdown = path.dirname(filePath) === path.resolve(fullPath)
          && path.extname(filePath).toLowerCase() === '.md';
        if (!isDirectMarkdown) {
          deps.sendJson(res, 400, { error: 'bad_request', message: 'Nome de documento inválido' });
          return;
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          deps.sendJson(res, 404, { error: 'not_found', message: 'Documento não encontrado: ' + docName });
          return;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        deps.sendJson(res, 200, { name: docName, type: docType, content });
      } else {
        // List all docs
        const files = fs.readdirSync(fullPath)
          .filter(f => f.endsWith('.md'))
          .map(f => ({ name: f, type: docType }));
        deps.sendJson(res, 200, { type: docType, count: files.length, files });
      }
    } catch (error) {
      deps.logger.error('Erro ao servir documentação:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao servir documentação' });
    }
  });

  registerJsonPost('/api/qa-waves/intelligence/generate-scenario', async (deps, body, req) => {
    const { vertical, journey, stage, gap, context } = body;
    if (!vertical || !journey || !stage || !gap) {
      const err = new Error('vertical, journey, stage e gap são obrigatórios');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return deps.generateWaveScenarioDraft({
      vertical,
      journey,
      stage,
      gap,
      context: context || {},
      tenantId: req.qaTenantId,
    });
  });

  registerJsonPost('/api/qa-waves/intelligence/generate-seeds', async (deps, body, req) => {
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
      tenantId: req.qaTenantId,
    });
  });

  registerJsonPost('/api/qa-waves/intelligence/approve-scenario', async (deps, body, req) => {
    const { draftId } = body;
    if (!draftId) {
      const err = new Error('draftId é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return deps.approveWaveDraft(draftId, {
      approvedBy: req.agent?.id || req.agent?.username || 'qa_waves',
      tenantId: req.qaTenantId,
    });
  });

  registerJsonPost('/api/qa-waves/intelligence/reject-scenario', async (deps, body, req) => {
    const { draftId, reason } = body;
    if (!draftId) {
      const err = new Error('draftId é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    return deps.rejectWaveDraft(draftId, {
      rejectedBy: req.agent?.id || req.agent?.username || 'qa_waves',
      reason: reason || '',
      tenantId: req.qaTenantId,
    });
  });

  router.get('/api/qa-waves/intelligence/drafts', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    try {
      const { status, vertical, journey } = req.query || {};
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const drafts = deps.listWaveDrafts({
        status: status || null,
        vertical: vertical || null,
        journey: journey || null,
        tenantId,
      });
      deps.sendJson(res, 200, { items: drafts, count: drafts.length });
    } catch (error) {
      deps.logger.error('Erro ao listar drafts de IA:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar drafts' });
    }
  });

  // ─── Governance ───────────────────────────────────────────────────────────

  router.get('/api/qa-waves/operational/summary', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId || !enforceSystemTenant(deps, req, res, tenantId)) return;
      const report = deps.getOperationalSnapshot();
      deps.sendJson(res, 200, report);
    } catch (error) {
      deps.logger.error('Erro ao obter resumo operacional QA Waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter resumo operacional' });
    }
  });

  registerJsonPost('/api/qa-waves/operational/recompute', async (deps, body, req, res) => {
    if (!enforceSystemTenant(deps, req, res, req.qaTenantId)) return { __sent: true };
    const persist = body?.persist !== false;
    return deps.buildOperationalSnapshot({
      persist,
      policy: body?.policy || {},
    });
  });

  router.get('/api/qa-waves/operational/gaps', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId || !enforceSystemTenant(deps, req, res, tenantId)) return;
      const report = deps.getOperationalSnapshot();
      deps.sendJson(res, 200, {
        summary: report.summary,
        governance: report.governance,
        coverage: report.coverage,
        gaps: report.gaps,
        autoGeneration: report.autoGeneration,
      });
    } catch (error) {
      deps.logger.error('Erro ao obter gaps operacionais QA Waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter gaps operacionais' });
    }
  });

  router.get('/api/qa-waves/enterprise-governance', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId || !enforceSystemTenant(deps, req, res, tenantId)) return;
      const enterpriseGovernance = buildQaWavesEnterpriseGovernance({ root: ROOT_DIR });
      const runtimeGovernance = readJsonIfExists(RUNTIME_GOVERNANCE_REPORT_PATH);
      const globalGoNoGo = readJsonIfExists(GO_NO_GO_REPORT_PATH);
      deps.sendJson(res, 200, {
        ...enterpriseGovernance,
        globalGoNoGo: globalGoNoGo?.decision || globalGoNoGo?.status || enterpriseGovernance.governanceStatus,
        runtimeGovernance: runtimeGovernance ? {
          gateStatus: runtimeGovernance.gateStatus || runtimeGovernance.status || 'unknown',
          classification: runtimeGovernance.classification || 'unknown',
          path: process.env.RUNTIME_GOVERNANCE_REPORT_PATH || 'qa/runtime-governance-report.json',
        } : null,
      });
    } catch (error) {
      deps.logger.error('Erro ao obter governance enterprise QA Waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter governance enterprise QA Waves' });
    }
  });

  router.get('/api/qa-waves/governance', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;
    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const reports = deps.listWaveGovernanceReports(tenantId);
      deps.sendJson(res, 200, { items: reports, count: reports.length });
    } catch (error) {
      deps.logger.error('Erro ao listar relatórios de governança:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar governança' });
    }
  });

  registerJsonPost('/api/qa-waves/governance/evaluate', async (deps, body, req, res) => {
    if (!enforceSystemTenant(deps, req, res, req.qaTenantId)) return { __sent: true };
    const { waveId, scenarioIds, policy } = body;
    if (!waveId) {
      const err = new Error('waveId é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }
    const scenarios = await deps.listWaveScenarios({ tenantId: req.qaTenantId });
    const allScenarios = Array.isArray(scenarios?.items) ? scenarios.items : (Array.isArray(scenarios) ? scenarios : []);
    const filtered = scenarioIds && Array.isArray(scenarioIds)
      ? allScenarios.filter((s) => scenarioIds.includes(s.id || s.scenarioId))
      : allScenarios;

    const governance = deps.evaluateWaveGovernance({
      waveId,
      scenarios: filtered,
      policy: policy || {},
      tenantId: req.qaTenantId,
    });
    const operational = deps.buildOperationalSnapshot({ persist: true });

    return {
      governance,
      operationalGovernance: operational.governance,
      operationalSummary: operational.summary,
      decision: operational.governance?.goNoGo || governance.status || 'NO_GO',
    };
  });

  // ===== AUTONOMOUS GAP CLOSURE ENGINE ENDPOINTS =====

  router.get('/api/qa-waves/closure/analyze-gaps', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId || !enforceSystemTenant(deps, req, res, tenantId)) return;
      const analysis = await deps.analyzeGapsForAutoClosure({
        tenantId,
        persistGeneratedScenarios: false,
      });
      deps.sendJson(res, 200, analysis);
    } catch (error) {
      deps.logger.error('Erro ao analisar gaps:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao analisar gaps' });
    }
  });

  router.get('/api/qa-waves/closure/report', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId || !enforceSystemTenant(deps, req, res, tenantId)) return;
      const report = await deps.generateGapClosureReport({
        tenantId,
        persistGeneratedScenarios: false,
      });
      deps.sendJson(res, 200, report);
    } catch (error) {
      deps.logger.error('Erro ao gerar closure report:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao gerar report' });
    }
  });

  registerJsonPost('/api/qa-waves/closure/preflight', async (deps, body, req) => {
    const { waveId, journeyId, scenarioIds, capabilityIds, context } = body;
    if (!waveId) {
      const err = new Error('waveId é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const validation = await deps.validatePreflight({
      waveId,
      journeyId,
      scenarioIds: scenarioIds || [],
      capabilityIds: capabilityIds || [],
      tenantId: req.qaTenantId,
      context: { ...(context || {}), tenantId: req.qaTenantId },
    });

    return validation;
  });

  registerJsonPost('/api/qa-waves/closure/autonomous-loop', async (deps, body, req) => {
    const payload = {
      waveId: body.waveId,
      journeyId: body.journeyId,
      scenarioIds: body.scenarioIds || [],
      capabilityIds: body.capabilityIds || [],
      tenantId: req.qaTenantId,
      context: { ...(body.context || {}), tenantId: req.qaTenantId },
      capabilities: body.capabilities || [],
      discovery: body.discovery || {},
      dependencies: body.dependencies || {},
      journeyContracts: body.journeyContracts || {},
      policy: body.policy || {},
      expectedConsequences: body.expectedConsequences || [],
      maxRetries: body.maxRetries,
    };

    return deps.executeAutonomousGapClosureLoop(payload);
  });

  router.get('/api/qa-waves/closure/autonomous-loop/smoke-payload', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    if (!enforceDevelopmentClassification(deps, req, res)) return;

    try {
      const tenantId = requireAuthenticatedTenant(deps, req, res, auth);
      if (!tenantId) return;
      const payload = deps.buildStagingAutonomousLoopPayload({
        waveId: req.query?.waveId || undefined,
        journeyId: req.query?.journeyId || undefined,
        tenantId,
        ticketId: req.query?.ticketId || undefined,
        contactId: req.query?.contactId || undefined,
        membershipId: req.query?.membershipId || undefined,
        credentialId: req.query?.credentialId || undefined,
        deviceId: req.query?.deviceId || undefined,
        subscriptionId: req.query?.subscriptionId || undefined,
      });

      const runProbe = String(req.query?.probe || '').trim().toLowerCase();
      if (runProbe === 'true' || runProbe === '1') {
        const readiness = await deps.runIntegrationReadinessProbe(payload);
        deps.sendJson(res, 200, {
          status: readiness.allReady ? 'ready' : 'not_ready',
          mode: 'staging_smoke',
          readiness,
          payload,
        });
        return;
      }

      deps.sendJson(res, 200, {
        status: 'ready',
        mode: 'staging_smoke',
        payload,
      });
    } catch (error) {
      deps.logger.error('Erro ao montar smoke payload do loop autônomo:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao montar smoke payload' });
    }
  });

  registerJsonPost('/api/qa-waves/closure/autonomous-loop/smoke-run', async (deps, body, req) => {
    const built = deps.buildStagingAutonomousLoopPayload({ ...(body || {}), tenantId: req.qaTenantId });
    const payload = {
      ...built,
      ...body,
      tenantId: req.qaTenantId,
      context: {
        ...(built.context || {}),
        ...(body?.context || {}),
        tenantId: req.qaTenantId,
      },
    };
    return deps.executeAutonomousGapClosureLoop(payload);
  });

  registerJsonPost('/api/qa-waves/closure/validate-replay', async (deps, body) => {
    const { replay } = body;
    if (!replay) {
      const err = new Error('replay é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const validation = deps.validateReplayOperationality(replay);
    return validation;
  });

  registerJsonPost('/api/qa-waves/closure/classify-operationality', async (deps, body) => {
    const { executionTrace, chainName } = body;
    if (!executionTrace) {
      const err = new Error('executionTrace é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const classification = deps.classifyOperationality(executionTrace, chainName);
    return classification;
  });

  // ===== AUTO-GENERATION BOT ENDPOINTS =====

  registerJsonPost('/api/qa-waves/bot/generate-scenarios', async (deps, body, req) => {
    const { capabilities, frontendData } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.executeScenarioGeneration(capabilities, frontendData || {}, {
      persist: true,
      tenantId: req.qaTenantId,
    });
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/generate-ui-steps', async (deps, body, req) => {
    const { capabilities, frontendData } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.executeUIStepGeneration(capabilities, frontendData || {}, { tenantId: req.qaTenantId });
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/generate-validators', async (deps, body, req) => {
    const { capabilities } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.executeValidatorGeneration(capabilities, { tenantId: req.qaTenantId });
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/generate-seeds', async (deps, body, req) => {
    const { capabilities } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.executeSeedGeneration(capabilities, { tenantId: req.qaTenantId });
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/validate-preflight', async (deps, body, req) => {
    const { capabilities, context } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = await deps.validatePreflightForCapabilities(capabilities, {
      context: { ...(context || {}), tenantId: req.qaTenantId },
      tenantId: req.qaTenantId,
    });
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/execute-full-generation', async (deps, body, req) => {
    const { capabilities, frontendData, context, generateScenarios, generateUISteps, generateValidators, generateSeeds, validatePreflight } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = await deps.executeFullGenerationBot({
      capabilities,
      frontendData: frontendData || {},
      context: { ...(context || {}), tenantId: req.qaTenantId },
      generateScenarios: generateScenarios !== false,
      generateUISteps: generateUISteps !== false,
      generateValidators: generateValidators !== false,
      generateSeeds: generateSeeds !== false,
      validatePreflight: validatePreflight !== false,
      tenantId: req.qaTenantId,
    });

    return result;
  });

  registerJsonPost('/api/qa-waves/bot/apply-remediations', async (deps, body, req) => {
    const { remediations, capabilities, frontendData } = body;
    if (!remediations) {
      const err = new Error('remediations é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.applyAutoRemediations(remediations, capabilities || [], frontendData || {}, {
      tenantId: req.qaTenantId,
    });
    return result;
  });

  return router;
}

module.exports = {
  createQaWavesRoutes,
};
