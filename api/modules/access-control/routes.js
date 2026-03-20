'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createAccessControlRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/accessControlRoutes').handleAccessControlRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createAccessControlRoutes,
};
