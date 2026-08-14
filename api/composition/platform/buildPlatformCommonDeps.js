'use strict';

const crypto = require('crypto');
const { checkRateLimit } = require('../../../infra/rate-limit');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { logAction, logActionRequired } = require('../../services/auditService');
const {
  parseJsonBody,
  setCorsHeaders,
  sendJson,
  badRequest,
  hasJsonContentType,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');

function buildPlatformCommonDeps({ req, res, detectProcessManager, requireTenant }) {
  return {
    req,
    res,
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
    logActionRequired,
    requireTenant,
    crypto,
    setCorsHeaders,
    detectProcessManager,
    checkRateLimit,
  };
}

module.exports = {
  buildPlatformCommonDeps,
};
