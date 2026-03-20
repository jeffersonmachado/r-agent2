'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createWhatsAppConnectionRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/whatsAppConnectionRoutes').handleWhatsAppConnectionRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createWhatsAppConnectionRoutes,
};
