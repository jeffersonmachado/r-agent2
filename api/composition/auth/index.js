'use strict';

/**
 * Composition root do dominio Auth.
 *
 * Remove do registerRoutes a responsabilidade de montar
 * dependencias e router de autenticacao.
 */

const {
  sendJson,
  badRequest,
} = require('../../express/httpHelpers');
const { validateInput, ValidationError, schemas } = require('../../utils/inputValidator');
const {
  login: authLogin,
  createSaasSignupAccount,
  logout: authLogout,
  logoutAllSessions,
  validateToken,
  loginWithRpaToken,
} = require('../../services/authService');
const { logAction } = require('../../services/auditService');
const logger = require('../../utils/logger');
const { requireAuth } = require('../../middleware/auth');
const { checkClassification } = require('../../middleware/requireClassification');
const { checkRateLimit } = require('../../../infra/rate-limit');
const { createAuthRoutes } = require('../../modules/auth/routes');

function buildAuthRouteDeps() {
  return {
    sendJson,
    badRequest,
    validateInput,
    schemas,
    ValidationError,
    authLogin,
    createSaasSignupAccount,
    loginWithRpaToken,
    validateToken,
    authLogout,
    logoutAllSessions,
    logAction,
    logger,
    requireAuth,
    checkClassification,
    checkRateLimit,
  };
}

function createAuthExpressRouter() {
  return createAuthRoutes(buildAuthRouteDeps());
}

module.exports = {
  buildAuthRouteDeps,
  createAuthExpressRouter,
};
