'use strict';

const { createPlatformContentRoutes } = require('../../modules/platform-content/routes');

function createPlatformContentExpressRouter({ buildPlatformRoutingContext }) {
  return createPlatformContentRoutes({ buildDeps: buildPlatformRoutingContext });
}

module.exports = {
  createPlatformContentExpressRouter,
};
