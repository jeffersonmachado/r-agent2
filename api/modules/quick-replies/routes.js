'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { handleQuickRepliesRoutes } = require('../../serverHandlers/quickRepliesRoutes');

function createQuickRepliesRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: handleQuickRepliesRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createQuickRepliesRoutes,
};
