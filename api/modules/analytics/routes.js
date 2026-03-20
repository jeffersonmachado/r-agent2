'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { handleAnalyticsRoutes } = require('../../serverHandlers/analyticsRoutes');

function createAnalyticsRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: handleAnalyticsRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createAnalyticsRoutes,
};
