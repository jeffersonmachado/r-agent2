'use strict';

const express = require('express');
const automationRuntime = require('../../services/automationService');
const { createAutomationService } = require('./service');
const { createAutomationController } = require('./controller');

function createAutomationRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createAutomationService({ automationRuntime });

  function controllerFor(req, res) {
    return createAutomationController({
      service,
      deps: buildDeps(req, res),
    });
  }

  router.get('/automations', (req, res) => controllerFor(req, res).list(req, res));
  router.post('/automations', (req, res) => controllerFor(req, res).create(req, res));
  router.post('/automations/:automationId/publish', (req, res) => controllerFor(req, res).publish(req, res));
  router.post('/automations/:automationId/run', (req, res) => controllerFor(req, res).run(req, res));

  return router;
}

module.exports = {
  createAutomationRoutes,
};
