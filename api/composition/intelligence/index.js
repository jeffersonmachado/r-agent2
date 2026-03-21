'use strict';

/**
 * Composition root do dominio Intelligence.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createIntelligenceRoutes } = require('../../modules/intelligence/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildIntelligenceRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  };
}

function createIntelligenceExpressRouter() {
  return createIntelligenceRoutes({ buildDeps: () => buildIntelligenceRouteDeps() });
}

module.exports = {
  buildIntelligenceRouteDeps,
  createIntelligenceExpressRouter,
};
