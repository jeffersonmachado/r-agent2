'use strict';

/**
 * Composition root do domínio Push (Web Push / PWA).
 */

const { requireAuth } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const pushNotificationService = require('../../services/pushNotificationService');
const { createPushRoutes } = require('../../modules/push/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildPushRouteDeps() {
  return {
    requireAuth,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    pushNotificationService,
  };
}

function createPushExpressRouter() {
  return createPushRoutes({ buildDeps: () => buildPushRouteDeps() });
}

module.exports = {
  buildPushRouteDeps,
  createPushExpressRouter,
};
