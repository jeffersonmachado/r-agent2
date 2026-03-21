'use strict';

const express = require('express');
const { handleSystemAdminRoutes } = require('./handleSystemAdminRoutes');
const { handleSystemGenerationRoutes } = require('./handleSystemGenerationRoutes');
const { handleSuperAdminRoutes } = require('./handleSuperAdminRoutes');
const { handleOnboardingRoutes } = require('./handleOnboardingRoutes');

function createDomainAdminRoutes({ buildDeps }) {
  const router = express.Router();

  function runHandled(handler, selectDeps) {
    return async (req, res, next) => {
      try {
        const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
        const ctx = buildDeps(req, res);
        const handled = await handler({
          req,
          res,
          method: (req.method || 'GET').toUpperCase(),
          pathname,
          deps: selectDeps(ctx),
        });
        if (!handled && !res.writableEnded) {
          next();
        }
      } catch (err) {
        next(err);
      }
    };
  }

  // System Admin
  router.use(runHandled(handleSystemAdminRoutes, (ctx) => ({
    clearLimitersCache: ctx.clearLimitersCache,
    clearRedisRateLimitKeys: ctx.clearRedisRateLimitKeys,
    config: ctx.config,
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    logger: ctx.logger,
  })));

  // System Generation
  router.use(runHandled(handleSystemGenerationRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    isSuperAdmin: ctx.isSuperAdmin,
    requireTenant: ctx.requireTenant,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
    generateAiResponse: ctx.generateAiResponse,
    getAIConfig: ctx.getAIConfig,
    getDecryptedAPIKey: ctx.getDecryptedAPIKey,
    ragService: ctx.ragService,
    STRICT_TENANT_MODE: ctx.STRICT_TENANT_MODE,
    generateAndValidate: ctx.generateAndValidate,
  })));

  // Super Admin
  router.use(runHandled(handleSuperAdminRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    isSuperAdmin: ctx.isSuperAdmin,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
    logAction: ctx.logAction,
    listAllTenants: ctx.listAllTenants,
    getTenantMetrics: ctx.getTenantMetrics,
    impersonateUser: ctx.impersonateUser,
    blockTenant: ctx.blockTenant,
    unblockTenant: ctx.unblockTenant,
    adjustTenantPlan: ctx.adjustTenantPlan,
  })));

  // Onboarding
  router.use(runHandled(handleOnboardingRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
    logAction: ctx.logAction,
    getOnboardingStatus: ctx.getOnboardingStatus,
    startOnboarding: ctx.startOnboarding,
    completeOnboardingStep: ctx.completeOnboardingStep,
    completeOnboarding: ctx.completeOnboarding,
    createInitialTemplates: ctx.createInitialTemplates,
  })));

  return router;
}

module.exports = {
  createDomainAdminRoutes,
};
