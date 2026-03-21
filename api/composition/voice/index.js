'use strict';

/**
 * Composition root do dominio Voice.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');
const { createVoiceRoutes } = require('../../modules/voice/routes');

function buildVoiceRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  };
}

function createVoiceExpressRouter() {
  return createVoiceRoutes({ buildDeps: () => buildVoiceRouteDeps() });
}

module.exports = {
  buildVoiceRouteDeps,
  createVoiceExpressRouter,
};
