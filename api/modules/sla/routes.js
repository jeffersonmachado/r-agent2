'use strict';

const express = require('express');
const slaService = require('../../services/slaService');
const { createSlaService } = require('./service');
const { createSlaController } = require('./controller');

function createSlaRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createSlaService({ slaService });

  function controllerFor(req, res) {
    return createSlaController({
      service,
      deps: buildDeps(req, res),
    });
  }

  router.get('/sla/policies', (req, res) => controllerFor(req, res).listPolicies(req, res));
  router.post('/sla/policies', (req, res) => controllerFor(req, res).savePolicy(req, res));
  router.get('/sla/breaches', (req, res) => controllerFor(req, res).listBreaches(req, res));

  return router;
}

module.exports = {
  createSlaRoutes,
};
