'use strict';

/**
 * Composition root do dominio Operations Dashboard.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createOperationsDashboardRoutes } = require('../../modules/operations-dashboard/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildOperationsDashboardRouteDeps() {
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

function createOperationsDashboardExpressRouter() {
  return createOperationsDashboardRoutes({ buildDeps: () => buildOperationsDashboardRouteDeps() });
}

module.exports = {
  buildOperationsDashboardRouteDeps,
  createOperationsDashboardExpressRouter,
};
