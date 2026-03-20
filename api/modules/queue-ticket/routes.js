'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createQueueTicketRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/queueTicketRoutes').handleQueueTicketRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createQueueTicketRoutes,
};
