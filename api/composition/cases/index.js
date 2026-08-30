'use strict';

/**
 * Composition root do domínio Cases (Case Management sobre tickets).
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { requireTenant } = require('../shared/requireTenant');
const { createCaseRoutes } = require('../../modules/cases/routes');

function buildCaseRouteDeps() {
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

function createCasesExpressRouter() {
  return createCaseRoutes({ buildDeps: () => buildCaseRouteDeps() });
}

module.exports = {
  buildCaseRouteDeps,
  createCasesExpressRouter,
};
