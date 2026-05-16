'use strict';

const { requireAuth } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createDemoOrchestratorService } = require('../../services/demoOrchestratorService');
const { createDemoRoutes } = require('../../modules/demo/routes');

function buildDemoRouteDeps() {
  return {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    demoOrchestrator: createDemoOrchestratorService(),
  };
}

function createDemoExpressRouter() {
  return createDemoRoutes({
    buildDeps: () => buildDemoRouteDeps(),
  });
}

module.exports = {
  createDemoExpressRouter,
};
