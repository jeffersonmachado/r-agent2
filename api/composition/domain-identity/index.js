'use strict';

const { createDomainIdentityRoutes } = require('../../modules/domain-identity/routes');

function createDomainIdentityExpressRouter({ buildCoreRoutingContext }) {
  return createDomainIdentityRoutes({ buildDeps: buildCoreRoutingContext });
}

module.exports = {
  createDomainIdentityExpressRouter,
};
