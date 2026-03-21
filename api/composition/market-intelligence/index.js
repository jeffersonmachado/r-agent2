'use strict';

/**
 * Composition root do dominio Market Intelligence.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createMarketIntelligenceRoutes } = require('../../modules/market-intelligence/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildMarketIntelligenceRouteDeps() {
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

function createMarketIntelligenceExpressRouter() {
  return createMarketIntelligenceRoutes({ buildDeps: () => buildMarketIntelligenceRouteDeps() });
}

module.exports = {
  buildMarketIntelligenceRouteDeps,
  createMarketIntelligenceExpressRouter,
};
