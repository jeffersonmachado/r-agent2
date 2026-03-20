'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createWebScrapingRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/webScrapingRoutes').handleWebScrapingRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createWebScrapingRoutes,
};
