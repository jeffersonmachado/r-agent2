'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createFrontendFallbackRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/frontendFallbackRoutes').handleFrontendFallbackRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createFrontendFallbackRoutes,
};
