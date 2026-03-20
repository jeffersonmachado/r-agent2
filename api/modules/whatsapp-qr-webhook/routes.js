'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');

function createWhatsAppQrWebhookRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: require('../../serverHandlers/whatsAppQrWebhookRoutes').handleWhatsAppQrWebhookRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createWhatsAppQrWebhookRoutes,
};
