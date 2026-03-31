'use strict';

const express = require('express');
const { buildRagRouteContext } = require('../../routing/contextBuilders/buildRagRouteContext');
const { handleAiRoutes } = require('./handleAiRoutes');
const { handleTemplatesRoutes } = require('./handleTemplatesRoutes');
const { handleAiSuggestionRoutes } = require('./handleAiSuggestionRoutes');
const { handleAudioTranscriptionRoutes } = require('./handleAudioTranscriptionRoutes');
const { handleWhatsappTemplateRoutes } = require('./handleWhatsappTemplateRoutes');
const { handleRagRoutes } = require('../rag-documents/handleRagRoutes');

function runHandled(handler, selectDeps) {
  return async (req, res, next) => {
    const ctx = req.routeContext || req.appRouteContext || {};

    try {
      const handled = await handler({
        method: req.method,
        pathname: req.originalUrl || req.url,
        params: req.params || {},
        query: req.query || {},
        body: req.body,
        headers: req.headers,
        req,
        res,
        deps: selectDeps(ctx),
      });

      if (!handled && !res.headersSent && !res.writableEnded) {
        next();
      }
    } catch (error) {
      next(error);
    }
  };
}

function createPlatformContentRoutes({ buildDeps }) {
  const router = express.Router();

  // Initialize routing context on request (required for route handlers to access dependencies)
  router.use((req, res, next) => {
    if (!req.routeContext && !req.appRouteContext) {
      req.appRouteContext = buildDeps(req, res);
    }
    next();
  });

  router.use(runHandled(handleAiRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requireTenant: ctx.requireTenant,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
  })));

  router.use(runHandled(handleTemplatesRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
    crypto: ctx.crypto,
    flowTemplateMarketplaceService: ctx.flowTemplateMarketplaceService,
    validateFlowStructure: ctx.validateFlowStructure,
    validateFlow: ctx.validateFlow,
    validateVoiceFlow: ctx.validateVoiceFlow,
    ensureFlowHasMeta: ctx.ensureFlowHasMeta,
    persistFlowBestEffort: ctx.persistFlowBestEffort,
    flows: ctx.flows,
    triggerWebhooks: ctx.triggerWebhooks,
    emitEvent: ctx.emitEvent,
  })));

  router.use(runHandled(handleAiSuggestionRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
    isSuperAdmin: ctx.isSuperAdmin,
    suggestResponse: ctx.suggestResponse,
    rewriteMessage: ctx.rewriteMessage,
    rewriteMultipleMessages: ctx.rewriteMultipleMessages,
  })));

  router.use(runHandled(handleAudioTranscriptionRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
    transcribeAudio: ctx.transcribeAudio,
  })));

  router.use(runHandled(handleWhatsappTemplateRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logAction: ctx.logAction,
    logger: ctx.logger,
    listTemplates: ctx.listTemplates,
    getTemplate: ctx.getTemplate,
    createTemplate: ctx.createTemplate,
    sendTemplateMessage: ctx.sendTemplateMessage,
  })));

  router.use(runHandled(handleRagRoutes, (ctx) => buildRagRouteContext(ctx)));

  return router;
}

module.exports = {
  createPlatformContentRoutes,
};
