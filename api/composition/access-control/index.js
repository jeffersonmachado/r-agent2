'use strict';

/**
 * Composition root do dominio Access Control.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const { logAction } = require('../../services/auditService');
const logger = require('../../utils/logger');
const { createAccessControlRoutes } = require('../../modules/access-control/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildAccessControlRouteDeps() {
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

function createAccessControlExpressRouter() {
  return createAccessControlRoutes({ buildDeps: () => buildAccessControlRouteDeps() });
}

module.exports = {
  buildAccessControlRouteDeps,
  createAccessControlExpressRouter,
};
