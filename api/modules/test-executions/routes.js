'use strict';

const express = require('express');

function createTestExecutionsRoutes({ buildDeps }) {
  const router = express.Router();

  function mapErrorCodeToHttp(code) {
    if (code === 'BAD_REQUEST') return 400;
    if (code === 'NOT_FOUND') return 404;
    if (code === 'NOT_SUPPORTED') return 409;
    return 500;
  }

  function ensureAuth(deps, req, res) {
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return null;
    }
    return auth;
  }

  router.get('/api/test-executions/recordings', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;

    try {
      const recordings = deps.listRecordings();
      deps.sendJson(res, 200, { recordings });
    } catch (error) {
      deps.logger.error('Erro ao listar recordings unificados:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar recordings' });
    }
  });

  router.post('/api/test-executions/recordings/start', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;

    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const seedName = body.seedName || body.name;
      const initialUrl = body.initialUrl || body.url;
      const result = await deps.startManualRecording(seedName, initialUrl);

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

    try {
      const result = await deps.stopManualRecording(req.params.recordingId);
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

    try {
      const result = deps.getRecordingStatus(req.params.recordingId);
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

    try {
      const limit = req.query.limit;
      const offset = req.query.offset;
      const result = deps.listReplayFiles({ limit, offset });
      deps.sendJson(res, 200, result);
    } catch (error) {
      deps.logger.error('Erro ao listar replays unificados:', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar replays' });
    }
  });

  router.get('/api/test-executions/replays/:filename', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;

    try {
      const replay = deps.getReplayFile(req.params.filename);
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

  router.get('/api/test-executions/reports/:filename', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;

    try {
      const report = deps.getReportFile(req.params.filename);
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

    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const execution = await deps.createExecution(body || {}, {
        authToken: req.token || null,
        tenantId: auth.agent?.tenantId || null,
        agentId: auth.agent?.id || null,
      });
      deps.sendJson(res, 202, execution);
    } catch (error) {
      const status = mapErrorCodeToHttp(error.code);
      deps.sendJson(res, status, {
        error: status === 400 ? 'bad_request' : (status === 404 ? 'not_found' : 'internal_error'),
        message: error.message,
      });
    }
  });

  router.get('/api/test-executions/:executionId/artifacts', (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;

    try {
      const artifacts = deps.getExecutionArtifacts(req.params.executionId);
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

  router.post('/api/test-executions/:executionId/cancel', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuth(deps, req, res)) return;

    try {
      const result = await deps.cancelUnifiedExecution(req.params.executionId);
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

    try {
      const execution = deps.getExecutionStatus(req.params.executionId);
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
