'use strict';

const express = require('express');

function createQaWavesRoutes({ buildDeps }) {
  const router = express.Router();

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

  return router;
}

module.exports = {
  createQaWavesRoutes,
};
