'use strict';

/**
 * Composition root do domínio Product Metrics (P4.13).
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const { sendJson } = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const productMetricsService = require('../../services/productMetricsService');
const { createProductMetricsRoutes } = require('../../modules/product-metrics/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildProductMetricsRouteDeps() {
  return {
    requireAuth,
    requireTenant,
    requirePermission,
    sendJson,
    logger,
    productMetricsService,
  };
}

function createProductMetricsExpressRouter() {
  return createProductMetricsRoutes({ buildDeps: () => buildProductMetricsRouteDeps() });
}

module.exports = {
  buildProductMetricsRouteDeps,
  createProductMetricsExpressRouter,
};
