'use strict';

/**
 * Composition root do dominio Quick Replies.
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
  listQuickReplies,
  getQuickReply,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  incrementUsage,
  searchByContext,
} = require('../../services/quickRepliesService');
const { createQuickRepliesRoutes } = require('../../modules/quick-replies/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildQuickRepliesRouteDeps() {
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
    listQuickReplies,
    getQuickReply,
    createQuickReply,
    updateQuickReply,
    deleteQuickReply,
    incrementUsage,
    searchByContext,
  };
}

function createQuickRepliesExpressRouter() {
  return createQuickRepliesRoutes({ buildDeps: () => buildQuickRepliesRouteDeps() });
}

module.exports = {
  buildQuickRepliesRouteDeps,
  createQuickRepliesExpressRouter,
};
