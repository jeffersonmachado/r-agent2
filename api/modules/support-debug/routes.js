'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createSupportDebugRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/supportDebugRoutes').handleSupportDebugRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createSupportDebugRoutes,
};
