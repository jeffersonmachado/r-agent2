'use strict';

/**
 * Composition root do dominio Bulk Campaigns.
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
const {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
} = require('../../services/bulkMessagingService');
const { createBulkCampaignsRoutes } = require('../../modules/bulk-campaigns/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildBulkCampaignsRouteDeps() {
  return {
    requireAuth,
    requireTenant,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
    listCampaigns,
    getCampaign,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    startCampaign,
    pauseCampaign,
    resumeCampaign,
  };
}

function createBulkCampaignsExpressRouter() {
  return createBulkCampaignsRoutes({ buildDeps: () => buildBulkCampaignsRouteDeps() });
}

module.exports = {
  buildBulkCampaignsRouteDeps,
  createBulkCampaignsExpressRouter,
};
