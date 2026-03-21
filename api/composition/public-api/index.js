'use strict';

const { createPublicApiRoutes } = require('../../modules/public-api/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

function createPublicApiExpressRouter({ buildExtendedRoutingContext }) {
  return createPublicApiRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);
      return pickRouteDeps(ctx, [
        'sendJson',
        'badRequest',
        'hasJsonContentType',
        'parseJsonBody',
        'logger',
        'checkRateLimit',
      ]);
    },
  });
}

module.exports = {
  createPublicApiExpressRouter,
};
