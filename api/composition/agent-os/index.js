'use strict';

const { createAgentOsRoutes } = require('../../modules/agent-os');

function createAgentOsExpressRouter({ buildCoreRoutingContext }) {
  return createAgentOsRoutes({ buildDeps: buildCoreRoutingContext });
}

module.exports = {
  createAgentOsExpressRouter,
};
