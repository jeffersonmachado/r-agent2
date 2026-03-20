'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createPbxRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/pbxRoutes').handlePbxRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createPbxRoutes,
};
