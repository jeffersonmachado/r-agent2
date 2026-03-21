'use strict';

const { createDomainAdminRoutes } = require('../../modules/domain-admin/routes');

function createDomainAdminExpressRouter({ buildCoreRoutingContext }) {
  return createDomainAdminRoutes({ buildDeps: buildCoreRoutingContext });
}

module.exports = {
  createDomainAdminExpressRouter,
};
