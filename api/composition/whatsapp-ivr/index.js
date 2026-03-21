'use strict';

const { createWhatsAppIvrRoutes } = require('../../modules/whatsapp-ivr/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

function createWhatsAppIvrExpressRouter({ buildExtendedRoutingContext }) {
  return createWhatsAppIvrRoutes({
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
        'crypto',
      ]);
    },
  });
}

module.exports = {
  createWhatsAppIvrExpressRouter,
};
