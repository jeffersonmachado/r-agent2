'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  buildQaWavesEnterpriseGovernance,
} = require('../../../tools/system/lib/qa-waves-enterprise-governance-bridge');

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

  router.delete('/api/qa-waves/scenarios/:scenarioId', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      const result = deps.deleteWaveScenario(req.params.scenarioId);
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

    try {
      deps.sendJson(res, 200, deps.listJourneys());
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
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const result = deps.saveWaveJourney(body || {});
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
    try {
      const result = deps.deleteWaveJourney(req.params.journeyId, req.query.vertical);
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

  router.delete('/api/qa-waves/executions', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }

    try {
      const result = deps.clearWaveExecutions();
      deps.sendJson(res, 200, { ...result, message: 'Execucoes e historico limpos' });
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
      if (deps.emitWavesEvent) {
        deps.emitWavesEvent('qa-waves.execution.started', {
          executionId: execution.executionId,
          scenarioIds: body?.scenarioIds || [],
        }, { tenantId: req.agent?.tenantId || null });
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

  async function handleInferScenario(deps, body, req, res) {
    try {
      return await deps.inferWaveScenario({
        ...(body || {}),
        tenantId: req.agent?.tenantId || body?.tenantId || 'system',
        agentId: req.agent?.id || body?.agentId || null,
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

  registerJsonPost('/api/qa-waves/run', async (deps, body, req) => {
    return deps.runWaveScenario({ ...(body || {}), tenantId: req.agent?.tenantId || body?.tenantId || null });
  });

  registerJsonPost('/dev/qa-waves/run', async (deps, body, req) => {
    return deps.runWaveScenario({ ...(body || {}), tenantId: req.agent?.tenantId || body?.tenantId || null });
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

  // ─── Business Gaps ──────────────────────────────────────────────────────
  router.get('/api/qa-waves/intelligence/business-gaps', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    try {
      const { vertical, journey } = req.query || {};
      const result = deps.getBusinessGaps({ vertical: vertical || null, journey: journey || null });
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
    try {
      const docType = req.params.type;
      const docName = req.query.name || null;
      const baseDir = docType === 'roteiros' ? 'docs/roteiros' : 'docs/diagrams/qa-waves';
      const fullPath = path.join(ROOT_DIR, baseDir);

      if (!fs.existsSync(fullPath)) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Diretório de documentação não encontrado' });
        return;
      }

      if (docName) {
        // Serve specific doc
        const filePath = path.join(fullPath, docName);
        if (!fs.existsSync(filePath)) {
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

  router.get('/api/qa-waves/operational/summary', (req, res) => {
    const deps = buildDeps(req, res);
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return;
    }
    try {
      const report = deps.getOperationalSnapshot();
      deps.sendJson(res, 200, report);
    } catch (error) {
      deps.logger.error('Erro ao obter resumo operacional QA Waves:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter resumo operacional' });
    }
  });

  registerJsonPost('/api/qa-waves/operational/recompute', async (deps, body) => {
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
    try {
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
    try {
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

    const governance = deps.evaluateWaveGovernance({ waveId, scenarios: filtered, policy: policy || {} });
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

    try {
      const analysis = await deps.analyzeGapsForAutoClosure({});
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

    try {
      const report = await deps.generateGapClosureReport({});
      deps.sendJson(res, 200, report);
    } catch (error) {
      deps.logger.error('Erro ao gerar closure report:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao gerar report' });
    }
  });

  registerJsonPost('/api/qa-waves/closure/preflight', async (deps, body) => {
    const { waveId, journeyId, scenarioIds, capabilityIds, tenantId, context } = body;
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
      tenantId,
      context: context || {},
    });

    return validation;
  });

  registerJsonPost('/api/qa-waves/closure/autonomous-loop', async (deps, body) => {
    const payload = {
      waveId: body.waveId,
      journeyId: body.journeyId,
      scenarioIds: body.scenarioIds || [],
      capabilityIds: body.capabilityIds || [],
      tenantId: body.tenantId,
      context: body.context || {},
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

    try {
      const payload = deps.buildStagingAutonomousLoopPayload({
        waveId: req.query?.waveId || undefined,
        journeyId: req.query?.journeyId || undefined,
        tenantId: req.query?.tenantId || undefined,
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

  registerJsonPost('/api/qa-waves/closure/autonomous-loop/smoke-run', async (deps, body) => {
    const built = deps.buildStagingAutonomousLoopPayload(body || {});
    const payload = {
      ...built,
      ...body,
      context: {
        ...(built.context || {}),
        ...(body?.context || {}),
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

  registerJsonPost('/api/qa-waves/bot/generate-scenarios', async (deps, body) => {
    const { capabilities, frontendData } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.executeScenarioGeneration(capabilities, frontendData || {}, { persist: true });
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/generate-ui-steps', async (deps, body) => {
    const { capabilities, frontendData } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.executeUIStepGeneration(capabilities, frontendData || {});
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/generate-validators', async (deps, body) => {
    const { capabilities } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.executeValidatorGeneration(capabilities);
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/generate-seeds', async (deps, body) => {
    const { capabilities } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.executeSeedGeneration(capabilities);
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/validate-preflight', async (deps, body) => {
    const { capabilities, context } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = await deps.validatePreflightForCapabilities(capabilities, { context: context || {} });
    return result;
  });

  registerJsonPost('/api/qa-waves/bot/execute-full-generation', async (deps, body) => {
    const { capabilities, frontendData, context, generateScenarios, generateUISteps, generateValidators, generateSeeds, validatePreflight } = body;
    if (!capabilities || !Array.isArray(capabilities)) {
      const err = new Error('capabilities é obrigatório (array)');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = await deps.executeFullGenerationBot({
      capabilities,
      frontendData: frontendData || {},
      context: context || {},
      generateScenarios: generateScenarios !== false,
      generateUISteps: generateUISteps !== false,
      generateValidators: generateValidators !== false,
      generateSeeds: generateSeeds !== false,
      validatePreflight: validatePreflight !== false,
    });

    return result;
  });

  registerJsonPost('/api/qa-waves/bot/apply-remediations', async (deps, body) => {
    const { remediations, capabilities, frontendData } = body;
    if (!remediations) {
      const err = new Error('remediations é obrigatório');
      err.code = 'BAD_REQUEST';
      throw err;
    }

    const result = deps.applyAutoRemediations(remediations, capabilities || [], frontendData || {});
    return result;
  });

  return router;
}

module.exports = {
  createQaWavesRoutes,
};
