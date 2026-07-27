'use strict';

const express = require('express');
const { normalizeVertical } = require('../../services/demoOrchestratorService');

function createDemoRoutes({ buildDeps }) {
  const router = express.Router();

  function ensureAuth(deps, req, res) {
    const auth = deps.requireAuth(req);
    if (!auth.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error });
      return null;
    }
    return auth;
  }

  router.get('/api/demo/state', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = ensureAuth(deps, req, res);
    if (!auth) return;

    try {
      const vertical = normalizeVertical(req.query?.vertical);
      const state = await deps.demoOrchestrator.getState({
        vertical,
        auth: {
          token: req.token || null,
          agent: auth.agent || null,
        },
      });
      deps.sendJson(res, 200, state);
    } catch (error) {
      deps.logger.error('[DemoRoutes] Error loading /api/demo/state', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Error loading demo state' });
    }
  });

  router.post('/api/demo/run', async (req, res) => {
    const deps = buildDeps(req, res);
    const auth = ensureAuth(deps, req, res);
    if (!auth) return;

    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type must be application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const vertical = normalizeVertical(body?.vertical || req.query?.vertical);
      const result = await deps.demoOrchestrator.runDemo({
        vertical,
        auth: {
          token: req.token || null,
          agent: auth.agent || null,
        },
      });
      deps.sendJson(res, 202, result);
    } catch (error) {
      if (error.code === 'NOT_FOUND') {
        deps.sendJson(res, 404, { error: 'not_found', message: error.message });
        return;
      }
      if (error.code === 'BAD_REQUEST') {
        deps.sendJson(res, 400, { error: 'bad_request', message: error.message, details: error.details || undefined });
        return;
      }
      if (error.code === 'MISSING_PLATFORM_SCENARIO_IDS' || error.code === 'PIPELINE_ONLY_SCENARIO') {
        deps.sendJson(res, 422, { error: 'demo_run_unavailable', code: error.code, message: error.message });
        return;
      }
      deps.logger.error('[DemoRoutes] Error running /api/demo/run', error);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Error running demo flow' });
    }
  });

  return router;
}

module.exports = {
  createDemoRoutes,
};
