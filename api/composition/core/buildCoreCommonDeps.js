'use strict';

const config = require('../../utils/config');
const logger = require('../../utils/logger');
const { clearLimitersCache, clearRedisRateLimitKeys, checkRateLimit } = require('../../../infra/rate-limit');
const { requireAuth, requirePermission } = require('../../middleware/auth');
const { sendJson, badRequest, hasJsonContentType, parseJsonBody } = require('../../express/httpHelpers');
const { validateInput, ValidationError, schemas } = require('../../utils/inputValidator');
const { logAction, registerGeneration } = require('../../services/auditService');
const { isSuperAdmin } = require('../../services/superAdminService');
const { generateAiResponse } = require('../../services/aiProviderService');
const { getAIConfig, getDecryptedAPIKey } = require('../../services/tenantAIService');
const ragService = require('../../services/ragService');
const { requireTenant } = require('../shared/requireTenant');

function buildCoreCommonDeps({ req, res, strictTenantMode }) {
  return {
    req,
    res,
    clearLimitersCache,
    clearRedisRateLimitKeys,
    checkRateLimit,
    config,
    requireAuth,
    requirePermission,
    sendJson,
    logger,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    validateInput,
    schemas,
    ValidationError,
    logAction,
    isSuperAdmin,
    generateAiResponse,
    registerGeneration,
    requireTenant,
    getAIConfig,
    getDecryptedAPIKey,
    ragService,
    STRICT_TENANT_MODE: strictTenantMode,
  };
}

module.exports = {
  buildCoreCommonDeps,
};
