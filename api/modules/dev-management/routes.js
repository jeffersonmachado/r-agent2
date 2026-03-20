'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createDevManagementRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/devManagementRoutes').handleDevManagementRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createDevManagementRoutes,
};
