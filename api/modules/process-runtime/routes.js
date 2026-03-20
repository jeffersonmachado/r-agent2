'use strict';

const express = require('express');
const durableProcessService = require('../../services/durableProcessService');
const { createProcessRuntimeService } = require('./service');
const { createProcessRuntimeController } = require('./controller');

function createProcessRuntimeRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createProcessRuntimeService({ durableProcessService });

  function controllerFor(req, res) {
    return createProcessRuntimeController({
      service,
      deps: buildDeps(req, res),
    });
  }

  router.get('/api/process-instances', (req, res) => controllerFor(req, res).listInstances(req, res));
  router.post('/api/process-runtime/start', (req, res) => controllerFor(req, res).start(req, res));
  router.get('/api/process-runtime/analytics', (req, res) => controllerFor(req, res).analytics(req, res));
  router.post('/api/process-runtime/simulate', (req, res) => controllerFor(req, res).simulate(req, res));
  router.post('/api/process-runtime/intelligence', (req, res) => controllerFor(req, res).intelligence(req, res));
  router.post('/api/process-instances/resume/external', (req, res) => controllerFor(req, res).resumeExternal(req, res));
  router.get('/api/process-instances/:executionId/history', (req, res) => controllerFor(req, res).getHistory(req, res));
  router.post('/api/process-instances/:executionId/cancel', (req, res) => controllerFor(req, res).cancel(req, res));
  router.post('/api/process-instances/:executionId/resume', (req, res) => controllerFor(req, res).resume(req, res));
  router.get('/api/process-instances/:executionId', (req, res) => controllerFor(req, res).getInstance(req, res));

  return router;
}

module.exports = {
  createProcessRuntimeRoutes,
};
