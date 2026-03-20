'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createWebhooksRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/webhooksRoutes').handleWebhooksRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createWebhooksRoutes,
};
