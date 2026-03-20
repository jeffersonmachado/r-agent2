'use strict';

const express = require('express');
const { createSupervisorService } = require('./service');
const { createSupervisorController } = require('./controller');

function createSupervisorRoutes({ buildDeps }) {
  const router = express.Router();

  function controllerFor(req, res) {
    const deps = buildDeps(req, res);
    const service = createSupervisorService(deps);

    return createSupervisorController({ service, deps });
  }

  router.get('/supervisor/metrics', (req, res) => controllerFor(req, res).metrics(req, res));
  router.get('/supervisor/agents/status', (req, res) => controllerFor(req, res).agentsStatus(req, res));
  router.get('/supervisor/queues/status', (req, res) => controllerFor(req, res).queuesStatus(req, res));

  return router;
}

module.exports = {
  createSupervisorRoutes,
};
