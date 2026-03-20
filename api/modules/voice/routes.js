'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createVoiceRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/voiceRoutes').handleVoiceRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createVoiceRoutes,
};
