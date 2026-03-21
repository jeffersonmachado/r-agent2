'use strict';

/**
 * Composition root do dominio Analytics.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const { sendJson } = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const {
  getGeneralMetrics,
  getAgentMetrics,
  getDepartmentMetrics,
  getQueueMetrics,
  getTrendMetrics,
  getAllMetrics,
} = require('../../services/analyticsService');
const { createAnalyticsRoutes } = require('../../modules/analytics/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildAnalyticsRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    logger,
    getAllMetrics,
    getGeneralMetrics,
    getAgentMetrics,
    getDepartmentMetrics,
    getQueueMetrics,
    getTrendMetrics,
  };
}

function createAnalyticsExpressRouter() {
  return createAnalyticsRoutes({ buildDeps: () => buildAnalyticsRouteDeps() });
}

module.exports = {
  buildAnalyticsRouteDeps,
  createAnalyticsExpressRouter,
};
