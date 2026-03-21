'use strict';

/**
 * Composition root do dominio Web Scraping.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
  setCorsHeaders,
} = require('../../express/httpHelpers');
const { sendApiError, buildApiError } = require('../../utils/apiError');
const { isSuperAdmin } = require('../../services/superAdminService');
const { logAction } = require('../../services/auditService');
const logger = require('../../utils/logger');
const { scrapeUrl, scrapeUrls } = require('../../services/webScrapingService');
const { createWebScrapingRoutes } = require('../../modules/web-scraping/routes');

function buildWebScrapingRouteDeps() {
  const { requireExecutionId } = require('../../middleware/requireExecutionId');
  const { createPipelineWs } = require('../../ws/pipelineEmitter');
  const { emitPipelineStage } = require('../../ws/emitPipelineStage');
  const { failGeneration } = require('../../services/failGeneration');
  const { GenerationFailureReasons } = require('../../constants/GenerationFailureReasons');
  const {
    ensureExecutionContext,
    requireStages,
    updateStage,
    updateStatus,
  } = require('../../services/pipelineExecutionContext');

  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    sendApiError,
    buildApiError,
    setCorsHeaders,
    hasJsonContentType,
    parseJsonBody,
    isSuperAdmin,
    logAction,
    logger,
    scrapeUrl,
    scrapeUrls,
    requireExecutionId,
    createPipelineWs,
    emitPipelineStage,
    ensureExecutionContext,
    requireStages,
    updateStage,
    updateStatus,
    failGeneration,
    GenerationFailureReasons,
  };
}

function createWebScrapingExpressRouter() {
  return createWebScrapingRoutes({ buildDeps: () => buildWebScrapingRouteDeps() });
}

module.exports = {
  buildWebScrapingRouteDeps,
  createWebScrapingExpressRouter,
};
