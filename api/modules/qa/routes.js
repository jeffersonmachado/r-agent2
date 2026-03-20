'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createQaRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/qaRoutes').handleQaRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createQaRoutes,
};
