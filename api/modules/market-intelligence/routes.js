'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createMarketIntelligenceRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/marketIntelligenceRoutes').handleMarketIntelligenceRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createMarketIntelligenceRoutes,
};
