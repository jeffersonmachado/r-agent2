'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createWhatsAppIvrRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/whatsAppIvrRoutes').handleWhatsAppIvrRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createWhatsAppIvrRoutes,
};
