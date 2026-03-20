'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createPublicSystemRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/publicSystemRoutes').handlePublicSystemRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createPublicSystemRoutes,
};
