'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createIntelligenceRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/intelligenceRoutes').handleIntelligenceRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createIntelligenceRoutes,
};
