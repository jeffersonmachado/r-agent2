'use strict';

const express = require('express');
const { createQueueService } = require('./service');
const { createQueueController } = require('./controller');

function createQueueRoutes({ buildDeps }) {
  const router = express.Router();

  function controllerFor(req, res) {
    const deps = buildDeps(req, res);
    const service = createQueueService({ deps });

    return createQueueController({
      service,
      deps,
    });
  }

  router.get('/queues', (req, res) => controllerFor(req, res).list(req, res));
  router.post('/queues', (req, res) => controllerFor(req, res).create(req, res));
  router.get('/queues/:queueName/tickets', (req, res) => controllerFor(req, res).listTickets(req, res));
  router.get('/queues/:queueName', (req, res) => controllerFor(req, res).getInfo(req, res));
  router.delete('/queues/:queueName', (req, res) => controllerFor(req, res).remove(req, res));

  return router;
}

module.exports = {
  createQueueRoutes,
};
