'use strict';

const { createQueueTicketRoutes } = require('../../modules/queue-ticket/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

function createQueueTicketExpressRouter({ buildExtendedRoutingContext }) {
  return createQueueTicketRoutes({
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
  createQueueTicketExpressRouter,
};
