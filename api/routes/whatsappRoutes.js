'use strict';

const { handleWhatsappQrRoutes } = require('./whatsapp/whatsappQrRoutes');
const { handleWhatsappIvrRoutes } = require('./whatsapp/whatsappIvrRoutes');
const { handleWhatsappWebhookRoutes } = require('./whatsapp/whatsappWebhookRoutes');
const { handleWhatsappTemplateRoutes } = require('./whatsapp/whatsappTemplateRoutes');

const whatsappRouteHandlers = Object.freeze([
  handleWhatsappQrRoutes,
  handleWhatsappIvrRoutes,
  handleWhatsappWebhookRoutes,
  handleWhatsappTemplateRoutes,
]);

async function handleWhatsappRoutes(context = {}) {
  for (const handler of whatsappRouteHandlers) {
    const handled = await handler(context);
    if (handled) return true;
  }

  return false;
}

module.exports = {
  handleWhatsappRoutes,
  whatsappRouteHandlers,
};
