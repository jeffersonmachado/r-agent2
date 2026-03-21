'use strict';

const { createPlatformAdminRoutes } = require('../../modules/platform-admin/routes');

function createPlatformAdminExpressRouter({ buildPlatformRoutingContext }) {
  return createPlatformAdminRoutes({ buildDeps: buildPlatformRoutingContext });
}

module.exports = {
  createPlatformAdminExpressRouter,
};
