'use strict';

const { createOpsRoutes } = require('../../modules/ops/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

function createOpsExpressRouter({ buildExtendedRoutingContext }) {
  return createOpsRoutes({
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
        'logAction',
      ]);
    },
  });
}

module.exports = {
  createOpsExpressRouter,
};
