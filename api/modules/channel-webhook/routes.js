'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createChannelWebhookRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/webhookRoutes').handleWebhookRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createChannelWebhookRoutes,
};
