'use strict';

const express = require('express');
const { checkClassification } = require('../../middleware/requireClassification');

function createTestExecutionsRoutes({ buildDeps }) {
  const router = express.Router();

  function mapErrorCodeToHttp(code) {
    if (code === 'BAD_REQUEST') return 400;
    if (code === 'NOT_FOUND') return 404;
    if (code === 'NOT_SUPPORTED') return 409;
    if (code === 'EXECUTION_ALREADY_RUNNING') return 409;
    if (code === 'FORBIDDEN') return 403;
    return 500;
  }

  // Replay/recordings/execuções de QA são ferramentas de suporte e engenharia:
  // exigem classificação SUPPORT ou superior (AGENTS.md: replay/RPA → SUPPORT).
  function ensureAuth(deps, req, res) {
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return null;
    }
    const check = checkClassification(req, 'SUPPORT');
    if (!check.allowed) {
      deps.sendJson(res, 403, {
        error: 'classification_required',
        required: check.required,
        classification: check.classification,
      });
      return null;
    }
    return auth;
  }

  function requireScopedTenant(deps, req, res) {
    const tenantId = req.tenantId || req.agent?.tenantId || req.agent?.tenant_id || null;
    if (!tenantId) {
      deps.sendJson(res, 400, { error: 'tenant_required', message: 'Selecione um tenant para esta operação' });
      return null;
    }
    return String(tenantId);
  }

  router.get('/api/test-executions/recordings', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const recordings = deps.listRecordings(tenantId);
      deps.sendJson(res, 200, { recordings });
    } catch (error) {
      deps.logger.error('Erro ao listar recordings unificados:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar recordings' });
    }
  });

  router.get('/api/test-executions/qa-waves/journeys', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      deps.sendJson(res, 200, deps.listQaWaveJourneys(tenantId));
    } catch (error) {
      deps.logger.error('Erro ao listar jornadas QA Waves pelo endpoint unificado:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar jornadas QA Waves' });
    }
  });

  router.get('/api/test-executions/qa-waves/journey-status', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      deps.sendJson(res, 200, deps.listQaWaveJourneyStatus(tenantId));
    } catch (error) {
      deps.logger.error('Erro ao listar status de jornadas QA Waves pelo endpoint unificado:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar status de jornadas QA Waves' });
    }
  });

  router.get('/api/test-executions/qa-waves/scenarios', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      deps.sendJson(res, 200, deps.listQaWaveScenarios({ ...(req.query || {}), tenantId }));
    } catch (error) {
      deps.logger.error('Erro ao listar cenários QA Waves pelo endpoint unificado:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar cenários QA Waves' });
    }
  });

  router.get('/api/test-executions/qa-waves/step-status', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      deps.sendJson(res, 200, deps.listQaWaveStepStatus({ ...(req.query || {}), tenantId }));
    } catch (error) {
      deps.logger.error('Erro ao listar status de passos QA Waves pelo endpoint unificado:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar status de passos QA Waves' });
    }
  });

  router.post('/api/test-executions/recordings/start', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const seedName = body.seedName || body.name;
      const initialUrl = body.initialUrl || body.url;
      const result = await deps.startManualRecording(seedName, initialUrl, tenantId);

      if (!result?.success) {
        deps.sendJson(res, 400, { error: 'validation_error', message: result?.error || 'Falha ao iniciar gravação' });
        return;
      }

      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao iniciar recording unificado:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao iniciar recording' });
    }
  });

  router.post('/api/test-executions/recordings/:recordingId/stop', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const result = await deps.stopManualRecording(req.params.recordingId, tenantId);
      if (!result?.success) {
        deps.sendJson(res, 400, { error: 'validation_error', message: result?.error || 'Falha ao parar gravação' });
        return;
      }
      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao parar recording unificado:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao parar recording' });
    }
  });

  router.get('/api/test-executions/recordings/:recordingId/status', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const result = deps.getRecordingStatus(req.params.recordingId, tenantId);
      if (!result?.success) {
        deps.sendJson(res, 404, { error: 'not_found', message: result?.error || 'Recording não encontrado' });
        return;
      }
      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao consultar status de recording unificado:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao consultar status de recording' });
    }
  });

  router.get('/api/test-executions/replays', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const limit = req.query.limit;
      const offset = req.query.offset;
      const search = req.query.search;
      const result = req.query.result;
      const dateRange = req.query.dateRange;
      const sortBy = req.query.sortBy;
      const sortOrder = req.query.sortOrder;
      const source = req.query.source;
      const waveId = req.query.waveId;
      const journeyId = req.query.journeyId;
      const scenarioId = req.query.scenarioId;
      const seedId = req.query.seedId;
      const executionId = req.query.executionId;
      const kind = req.query.kind;
      const replayList = deps.listReplayFiles({
        limit,
        offset,
        search,
        result,
        dateRange,
        sortBy,
        sortOrder,
        source,
        waveId,
        journeyId,
        scenarioId,
        seedId,
        executionId,
        kind,
        tenantId,
      });
      const payload = {
        ...replayList,
        pagination: {
          total: replayList.total,
          limit: replayList.limit,
          offset: replayList.offset,
          hasMore: replayList.offset + replayList.files.length < replayList.total,
        },
        filters: {
          search: String(search || '').trim(),
          result: result || 'all',
          dateRange: dateRange || 'all',
          sortBy: sortBy || 'date',
          sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
          source: source || '',
          waveId: waveId || '',
          journeyId: journeyId || '',
          scenarioId: scenarioId || '',
          seedId: seedId || '',
          executionId: executionId || '',
          kind: kind || '',
        },
      };
      deps.sendJson(res, 200, payload);
    } catch (error) {
      deps.logger.error('Erro ao listar replays unificados:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar replays' });
    }
  });

  router.get('/api/test-executions/replays/:filename', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const replay = deps.getReplayFile(req.params.filename, tenantId);
      if (!replay) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Replay não encontrado' });
        return;
      }
      deps.sendJson(res, 200, replay);
    } catch (error) {
      const status = mapErrorCodeToHttp(error.code);
      deps.sendJson(res, status, { error: error.code === 'BAD_REQUEST' ? 'bad_request' : 'internal_error', message: error.message });
    }
  });

  router.delete('/api/test-executions/replays/:filename', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const result = deps.deleteReplayFile(req.params.filename, tenantId);
      deps.sendJson(res, 200, result);
    } catch (error) {
      const status = mapErrorCodeToHttp(error.code);
      deps.sendJson(res, status, {
        error: status === 400 ? 'bad_request' : (status === 404 ? 'not_found' : 'internal_error'),
        message: error.message,
      });
    }
  });

  router.delete('/api/test-executions/replays', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const result = deps.deleteAllReplayFiles(tenantId);
      deps.sendJson(res, 200, result);
    } catch (error) {
      const status = mapErrorCodeToHttp(error.code);
      deps.sendJson(res, status, {
        error: status === 400 ? 'bad_request' : 'internal_error',
        message: error.message,
      });
    }
  });

  router.get('/api/test-executions/reports/:filename', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const report = deps.getReportFile(req.params.filename, tenantId);
      if (!report) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Relatório não encontrado' });
        return;
      }
      deps.sendJson(res, 200, report);
    } catch (error) {
      const status = mapErrorCodeToHttp(error.code);
      deps.sendJson(res, status, { error: error.code === 'BAD_REQUEST' ? 'bad_request' : 'internal_error', message: error.message });
    }
  });

  router.post('/api/test-executions', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = ensureAuth(deps, req, res);
    if (!auth) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const execution = await deps.createExecution(body || {}, {
        authToken: req.token || null,
        tenantId,
        agentId: auth.agent?.id || null,
      });
      deps.sendJson(res, 202, execution);
    } catch (error) {
      const status = mapErrorCodeToHttp(error.code);
      let errorCode = 'internal_error';
      if (status === 400) errorCode = 'bad_request';
      else if (status === 404) errorCode = 'not_found';
      else if (status === 409) errorCode = error.code === 'EXECUTION_ALREADY_RUNNING' ? 'execution_already_running' : 'conflict';
      deps.sendJson(res, status, {
        error: errorCode,
        message: error.message,
        ...(error.activeExecutionId ? { activeExecutionId: error.activeExecutionId } : {}),
      });
    }
  });

  router.get('/api/test-executions/:executionId/artifacts', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const artifacts = await deps.getExecutionArtifacts(req.params.executionId, tenantId);
      if (!artifacts) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
        return;
      }
      deps.sendJson(res, 200, artifacts);
    } catch (error) {
      deps.logger.error('Erro ao obter artifacts unificados:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter artifacts' });
    }
  });

  // Download de artefato persistido (roteiro, replay, trace visual ou screenshot).
  router.get('/api/test-executions/artifacts', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const items = await deps.listExecutionArtifacts(tenantId);
      deps.sendJson(res, 200, { items });
    } catch (error) {
      deps.logger.error('Erro ao listar execuções RPA persistidas:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar execuções RPA' });
    }
  });

  // Download de artefato persistido (roteiro, replay, trace visual ou screenshot).
  router.get('/api/test-executions/:executionId/artifact/:kind', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const artifact = await deps.getExecutionArtifact(req.params.executionId, req.params.kind, null, tenantId);
      if (!artifact) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Artefato não encontrado' });
        return;
      }
      if (artifact.json !== undefined) {
        deps.sendJson(res, 200, artifact.json);
        return;
      }
      res.setHeader('Content-Type', artifact.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
      res.setHeader('Content-Length', artifact.buffer.length);
      res.end(artifact.buffer);
    } catch (error) {
      deps.logger.error('Erro ao obter artefato de execução:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter artefato' });
    }
  });

  router.get('/api/test-executions/:executionId/artifact/screenshot/:index', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const artifact = await deps.getExecutionArtifact(req.params.executionId, 'screenshot', req.params.index, tenantId);
      if (!artifact) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Artefato não encontrado' });
        return;
      }
      res.setHeader('Content-Type', artifact.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
      res.setHeader('Content-Length', artifact.buffer.length);
      res.end(artifact.buffer);
    } catch (error) {
      deps.logger.error('Erro ao obter screenshot de execução:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter screenshot' });
    }
  });

  router.post('/api/test-executions/:executionId/cancel', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const result = await deps.cancelUnifiedExecution(req.params.executionId, tenantId);
      deps.sendJson(res, 200, result);
    } catch (error) {
      const status = mapErrorCodeToHttp(error.code);
      deps.sendJson(res, status, {
        error: status === 404 ? 'not_found' : (status === 400 ? 'bad_request' : 'validation_error'),
        message: error.message,
      });
    }
  });

  router.get('/api/test-executions/:executionId', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;
    const tenantId = requireScopedTenant(deps, req, res);
    if (!tenantId) return;

    try {
      const execution = deps.getExecutionStatus(req.params.executionId, tenantId);
      if (!execution) {
        deps.sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
        return;
      }
      deps.sendJson(res, 200, execution);
    } catch (error) {
      deps.logger.error('Erro ao obter status de execução unificada:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter status da execução' });
    }
  });

  return router;
}

module.exports = {
  createTestExecutionsRoutes,
};
