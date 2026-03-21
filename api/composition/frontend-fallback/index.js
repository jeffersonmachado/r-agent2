'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const { createFrontendFallbackRoutes } = require('../../modules/frontend-fallback/routes');

function createFrontendFallbackExpressRouter() {
  return createFrontendFallbackRoutes({
    buildDeps: () => ({
      fs,
      path,
      logger,
    }),
  });
}

module.exports = {
  createFrontendFallbackExpressRouter,
};
