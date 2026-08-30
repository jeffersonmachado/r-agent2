'use strict';

/**
 * Composition root do domínio Tenant Capabilities (feature flags por tenant).
 */

const { requireAuth } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createTenantCapabilitiesRoutes } = require('../../modules/tenant-capabilities/routes');

function buildTenantCapabilitiesRouteDeps() {
  return {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  };
}

function createTenantCapabilitiesExpressRouter() {
  return createTenantCapabilitiesRoutes({ buildDeps: () => buildTenantCapabilitiesRouteDeps() });
}

module.exports = {
  buildTenantCapabilitiesRouteDeps,
  createTenantCapabilitiesExpressRouter,
};
