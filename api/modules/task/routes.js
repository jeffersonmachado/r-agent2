'use strict';

const express = require('express');
const tasksService = require('../../services/tasksService');
const { createTaskService } = require('./service');
const { createTaskController } = require('./controller');

function createTaskRoutes({ buildDeps }) {
  const router = express.Router();
  const service = createTaskService({ tasksService });

  function controllerFor(req, res) {
    return createTaskController({
      service,
      deps: buildDeps(req, res),
    });
  }

  router.get('/tasks', (req, res) => controllerFor(req, res).list(req, res));
  router.post('/tasks', (req, res) => controllerFor(req, res).create(req, res));
  router.post('/tasks/:taskId/complete', (req, res) => controllerFor(req, res).complete(req, res));
  router.post('/tasks/:taskId/reminder', (req, res) => controllerFor(req, res).reminder(req, res));

  return router;
}

module.exports = {
  createTaskRoutes,
};
