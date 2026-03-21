'use strict';

const { createPlatformPublicRoutes } = require('../../modules/platform-public/routes');

function createPlatformPublicExpressRouter({ buildPlatformRoutingContext }) {
  return createPlatformPublicRoutes({ buildDeps: buildPlatformRoutingContext });
}

module.exports = {
  createPlatformPublicExpressRouter,
};
