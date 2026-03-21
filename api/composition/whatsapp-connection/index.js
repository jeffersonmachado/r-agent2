'use strict';

const { createWhatsAppConnectionRoutes } = require('../../modules/whatsapp-connection/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

function createWhatsAppConnectionExpressRouter({ buildExtendedRoutingContext }) {
  return createWhatsAppConnectionRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);
      return pickRouteDeps(ctx, [
        'requireAuth',
        'requirePermission',
        'requireTenant',
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
  createWhatsAppConnectionExpressRouter,
};
