'use strict';

const { handleWhatsAppWebhookRoutes } = require('./handleWhatsAppWebhookRoutes');
const { handleMessengerWebhookRoutes } = require('./handleMessengerWebhookRoutes');
const { handleInstagramWebhookRoutes } = require('./handleInstagramWebhookRoutes');

module.exports = { handleChannelWebhookRoutes };

async function handleChannelWebhookRoutes({ req, res, method, pathname, deps }) {
  if (await handleWhatsAppWebhookRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleMessengerWebhookRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleInstagramWebhookRoutes({ req, res, method, pathname, deps })) return true;
  return false;
}
