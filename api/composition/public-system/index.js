'use strict';

/**
 * Composition root do dominio Public System.
 *
 * Encapsula o builder de dependencias do router publico
 * para reduzir centralizacao em registerRoutes.
 */

const config = require('../../utils/config');
const logger = require('../../utils/logger');
const { checkRateLimit } = require('../../../infra/rate-limit');
const { requireAuth } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
  setCorsHeaders,
} = require('../../express/httpHelpers');
const { createPublicSystemRoutes } = require('../../modules/public-system/routes');

function buildPublicSystemRouteDeps() {
  return {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    config,
    checkRateLimit,
    setCorsHeaders,
    requireAuth,
  };
}

function createPublicSystemExpressRouter() {
  return createPublicSystemRoutes({ buildDeps: () => buildPublicSystemRouteDeps() });
}

module.exports = {
  buildPublicSystemRouteDeps,
  createPublicSystemExpressRouter,
};
