'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createRpaTestsRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/rpaTestsRoutes').handleRpaTestsRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createRpaTestsRoutes,
};
