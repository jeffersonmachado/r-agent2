'use strict';

/**
 * Composition root do dominio Dev Management.
 */

const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const { isSuperAdmin } = require('../../services/superAdminService');
const { logAction } = require('../../services/auditService');
const logger = require('../../utils/logger');
const { createDevManagementRoutes } = require('../../modules/dev-management/routes');

function buildDevManagementRouteDeps() {
  return {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    isSuperAdmin,
    logAction,
    logger,
    path,
    fs,
  };
}

function createDevManagementExpressRouter() {
  return createDevManagementRoutes({ buildDeps: () => buildDevManagementRouteDeps() });
}

module.exports = {
  buildDevManagementRouteDeps,
  createDevManagementExpressRouter,
};
