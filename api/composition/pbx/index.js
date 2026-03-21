'use strict';

/**
 * Composition root do dominio PBX.
 *
 * Isola a montagem de dependencias do router PBX para tirar
 * wiring especifico de registerRoutes.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const {
  sendJson,
  badRequest,
  hasJsonContentType,
  parseJsonBody,
} = require('../../express/httpHelpers');
const { parseMultipartFormData } = require('../../utils/multipartParser');
const { buildApiError } = require('../../utils/apiError');
const logger = require('../../utils/logger');
const { logAction } = require('../../services/auditService');
const { createPbxRoutes } = require('../../modules/pbx/routes');
const { requireTenant } = require('../shared/requireTenant');

function buildPbxRouteDeps() {
  return {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    parseMultipartFormData,
    logger,
    buildApiError,
    logAction,
  };
}

function createPbxExpressRouter() {
  return createPbxRoutes({ buildDeps: () => buildPbxRouteDeps() });
}

module.exports = {
  buildPbxRouteDeps,
  createPbxExpressRouter,
};
