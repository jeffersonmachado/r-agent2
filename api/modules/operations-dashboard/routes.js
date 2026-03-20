'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createOperationsDashboardRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/operationsDashboardRoutes').handleOperationsDashboardRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createOperationsDashboardRoutes,
};
