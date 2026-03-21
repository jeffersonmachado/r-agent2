'use strict';

/**
 * Composition root do dominio QA.
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
  getLatestQaResult,
  getQaHistory,
  getQaResultById,
  runQaManual,
  getQaStatistics,
} = require('../../services/qaService');
const { createQaRoutes } = require('../../modules/qa/routes');

function buildQaRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logAction,
    logger,
    getLatestQaResult,
    getQaHistory,
    getQaStatistics,
    getQaResultById,
    runQaManual,
  };
}

function createQaExpressRouter() {
  return createQaRoutes({ buildDeps: () => buildQaRouteDeps() });
}

module.exports = {
  buildQaRouteDeps,
  createQaExpressRouter,
};
