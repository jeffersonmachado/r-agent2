'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { handleSystemAdminRoutes } = require('../../serverHandlers/systemAdminRoutes');
const { handleSystemGenerationRoutes } = require('../../serverHandlers/systemGenerationRoutes');
const { handleSuperAdminRoutes } = require('../../serverHandlers/superAdminRoutes');
const { handleOnboardingRoutes } = require('../../serverHandlers/onboardingRoutes');

function createDomainAdminRoutes({ buildDeps }) {
  const router = express.Router();

  // System Admin
  mountExpressHandler(router, {
    handler: handleSystemAdminRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);
      return {
        clearLimitersCache: ctx.clearLimitersCache,
        clearRedisRateLimitKeys: ctx.clearRedisRateLimitKeys,
        config: ctx.config,
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        logger: ctx.logger,
      };
    },
  });

  // System Generation
  mountExpressHandler(router, {
    handler: handleSystemGenerationRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);
      return {
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
      };
    },
  });

  // Super Admin
  mountExpressHandler(router, {
    handler: handleSuperAdminRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);
      return {
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
      };
    },
  });

  // Onboarding
  mountExpressHandler(router, {
    handler: handleOnboardingRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);
      return {
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
      };
    },
  });

  return router;
}

module.exports = {
  createDomainAdminRoutes,
};
