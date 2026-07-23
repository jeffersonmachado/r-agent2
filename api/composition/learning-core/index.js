'use strict';

const { createLearningCoreRoutes } = require('../../modules/learning-core');

function createLearningCoreExpressRouter({ buildCoreRoutingContext }) {
  return createLearningCoreRoutes({ buildDeps: buildCoreRoutingContext });
}

module.exports = {
  createLearningCoreExpressRouter,
};
