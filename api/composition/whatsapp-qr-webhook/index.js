'use strict';

const { createWhatsAppQrWebhookRoutes } = require('../../modules/whatsapp-qr-webhook/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

function createWhatsAppQrWebhookExpressRouter({ buildExtendedRoutingContext }) {
  return createWhatsAppQrWebhookRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);
      return pickRouteDeps(ctx, [
        'requireAuth',
        'requirePermission',
        'sendJson',
        'badRequest',
        'hasJsonContentType',
        'parseJsonBody',
        'logger',
      ]);
    },
  });
}

module.exports = {
  createWhatsAppQrWebhookExpressRouter,
};
