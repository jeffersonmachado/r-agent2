'use strict';

/**
 * Composition root do dominio Vertical.
 *
 * Encapsula builder e montagem do router vertical
 * para reduzir acoplamento no registerRoutes.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { logAction } = require('../../services/auditService');
const { createVerticalRoutes } = require('../../modules/vertical/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildVerticalRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
  };
}

function createVerticalExpressRouter() {
  return createVerticalRoutes({ buildDeps: () => buildVerticalRouteDeps() });
}

module.exports = {
  buildVerticalRouteDeps,
  createVerticalExpressRouter,
};
