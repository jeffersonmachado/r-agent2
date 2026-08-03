'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { checkRateLimit } = require('../../../infra/rate-limit');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { logAction } = require('../../services/auditService');
const { isSuperAdmin } = require('../../services/superAdminService');
const { sendApiError, buildApiError } = require('../../utils/apiError');
const {
  parseJsonBody,
  parseJsonBodyWithRaw,
  setCorsHeaders,
  sendJson,
  badRequest,
  hasJsonContentType,
} = require('../../express/httpHelpers');
const logger = require('../../utils/logger');

function buildExtendedCommonDeps({ req, res, requireTenant }) {
  return {
    req,
    res,
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    parseJsonBodyWithRaw,
    isSuperAdmin,
    logAction,
    logger,
    setCorsHeaders,
    sendApiError,
    buildApiError,
    path,
    fs,
    crypto,
    requireTenant,
    checkRateLimit,
  };
}

module.exports = {
  buildExtendedCommonDeps,
};
