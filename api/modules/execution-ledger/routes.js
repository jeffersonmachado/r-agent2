'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createExecutionLedgerRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/executionLedgerRoutes').handleExecutionLedgerRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createExecutionLedgerRoutes,
};
