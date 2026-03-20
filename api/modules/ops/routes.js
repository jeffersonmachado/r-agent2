'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createOpsRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/opsRoutes').handleOpsRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createOpsRoutes,
};
