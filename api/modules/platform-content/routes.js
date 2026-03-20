'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { buildRagRouteContext } = require('../../routing/contextBuilders/buildRagRouteContext');
const { handleAiRoutes } = require('../../serverHandlers/aiRoutes');
const { handleTemplatesRoutes } = require('../../serverHandlers/templatesRoutes');
const { handleAiSuggestionRoutes } = require('../../serverHandlers/aiSuggestionRoutes');
const { handleAudioTranscriptionRoutes } = require('../../serverHandlers/audioTranscriptionRoutes');
const { handleWhatsappTemplateRoutes } = require('../../serverHandlers/whatsappTemplateRoutes');
const { handleRagRoutes } = require('../../serverHandlers/ragRoutes');

function createPlatformContentRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: handleAiRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
      };
    },
  });

  mountExpressHandler(router, {
    handler: handleTemplatesRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
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
      };
    },
  });

  mountExpressHandler(router, {
    handler: handleAiSuggestionRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
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
      };
    },
  });

  mountExpressHandler(router, {
    handler: handleAudioTranscriptionRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        transcribeAudio: ctx.transcribeAudio,
      };
    },
  });

  mountExpressHandler(router, {
    handler: handleWhatsappTemplateRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
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
      };
    },
  });

  mountExpressHandler(router, {
    handler: handleRagRoutes,
    buildDeps: (req, res) => buildRagRouteContext(buildDeps(req, res)),
  });

  return router;
}

module.exports = {
  createPlatformContentRoutes,
};