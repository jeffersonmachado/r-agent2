'use strict';

/**
 * Composition root do dominio Webhooks.
 *
 * Centraliza montagem de dependencias e criacao do router Express
 * para remover wiring especifico de webhooks do registerRoutes.
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
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  getAvailableEvents,
} = require('../../services/webhookService');
const { createWebhooksRoutes } = require('../../modules/webhooks/routes');

function buildWebhooksRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logAction,
    logger,
    getAvailableEvents,
    listWebhooks,
    getWebhook,
    createWebhook,
    updateWebhook,
    deleteWebhook,
  };
}

function createWebhooksExpressRouter() {
  return createWebhooksRoutes({ buildDeps: () => buildWebhooksRouteDeps() });
}

module.exports = {
  buildWebhooksRouteDeps,
  createWebhooksExpressRouter,
};
