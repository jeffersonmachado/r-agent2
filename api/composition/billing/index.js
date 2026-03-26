'use strict';

const { createBillingRoutes } = require('../../modules/billing/routes');

function createBillingExpressRouter() {
  return createBillingRoutes();
}

module.exports = {
  createBillingExpressRouter,
};
