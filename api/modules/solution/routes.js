'use strict';

const express = require('express');
const solutionsTemplateService = require('../../services/solutions/solutionsTemplateService');
const { createSolutionService } = require('./service');
const { createSolutionController } = require('./controller');

function createSolutionRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createSolutionService({ solutionsTemplateService });

  function controllerFor(req, res) {
    return createSolutionController({
      service,
      deps: buildDeps(req, res),
    });
  }

  router.get('/api/solutions/packs', (req, res) => controllerFor(req, res).listPacks(req, res));
  router.post('/api/solutions/packs/install', (req, res) => controllerFor(req, res).installPack(req, res));

  return router;
}

module.exports = {
  createSolutionRoutes,
};
