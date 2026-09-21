'use strict';

/**
 * Composition root do domínio Engineering Model Router V1 (DEVELOPMENT-only).
 */

const { requireAuth } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const engineeringTaskService = require('../../services/engineeringRouter/engineeringTaskService');
const engineeringRouterService = require('../../services/engineeringRouter/engineeringRouterService');
const engineeringModelStatsService = require('../../services/engineeringRouter/engineeringModelStatsService');
const releaseClosureService = require('../../services/engineeringRouter/releaseClosureService');
const { createEngineeringRouterRoutes } = require('../../modules/engineering-router/routes');

function buildEngineeringRouterRouteDeps() {
  return {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    engineeringTaskService,
    engineeringRouterService,
    engineeringModelStatsService,
    releaseClosureService,
  };
}

function createEngineeringRouterExpressRouter() {
  return createEngineeringRouterRoutes({ buildDeps: () => buildEngineeringRouterRouteDeps() });
}

module.exports = {
  buildEngineeringRouterRouteDeps,
  createEngineeringRouterExpressRouter,
};
