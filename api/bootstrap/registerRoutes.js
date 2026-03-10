'use strict';

function registerRoutes({ requestHandler }) {
  if (typeof requestHandler !== 'function') {
    throw new Error('requestHandler is required');
  }

  const { registerRouteLoaders } = require('../routes');
  const groups = registerRouteLoaders();

  return {
    requestHandler,
    groups,
  };
}

module.exports = {
  registerRoutes,
};
