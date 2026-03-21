'use strict';

const { createDomainFlowRoutes } = require('../../modules/domain-flow/routes');

function createDomainFlowExpressRouter({ buildCoreRoutingContext }) {
  return createDomainFlowRoutes({ buildDeps: buildCoreRoutingContext });
}

module.exports = {
  createDomainFlowExpressRouter,
};
