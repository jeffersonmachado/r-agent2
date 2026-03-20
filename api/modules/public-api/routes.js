'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createPublicApiRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/publicApiRoutes').handlePublicApiRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createPublicApiRoutes,
};
