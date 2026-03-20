'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { handleFlowCrudRoutes } = require('../../serverHandlers/flowCrudRoutes');
const { handleFlowExecutionRoutes } = require('../../serverHandlers/flowExecutionRoutes');
const { handleConversationRoutes } = require('../../serverHandlers/conversationRoutes');

function createDomainFlowRoutes({ buildDeps }) {
  const router = express.Router();

  // Flow CRUD
  mountExpressHandler(router, {
    handler: handleFlowCrudRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);
      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        logger: ctx.logger,
        validateFlow: ctx.validateFlow,
        validateVoiceFlow: ctx.validateVoiceFlow,
        validateFlowStructure: ctx.validateFlowStructure,
        ensureFlowHasMeta: ctx.ensureFlowHasMeta,
        flows: ctx.flows,
        persistFlowBestEffort: ctx.persistFlowBestEffort,
        deleteFlowBestEffort: ctx.deleteFlowBestEffort,
        triggerWebhooks: ctx.triggerWebhooks,
        emitEvent: ctx.emitEvent,
        isSuperAdmin: ctx.isSuperAdmin,
        STRICT_TENANT_MODE: ctx.STRICT_TENANT_MODE,
      };
    },
  });

  // Flow Execution
  mountExpressHandler(router, {
    handler: handleFlowExecutionRoutes,
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
        validateFlow: ctx.validateFlow,
        validateFlowStructure: ctx.validateFlowStructure,
        addUiMessage: ctx.addUiMessage,
        flows: ctx.flows,
        orchestrateGeneration: ctx.orchestrateGeneration,
        registerGeneration: ctx.registerGeneration,
        generateAuditReport: ctx.generateAuditReport,
        STRICT_TENANT_MODE: ctx.STRICT_TENANT_MODE,
        rpaDependencyResolver: ctx.rpaDependencyResolver,
        previewRpaFlowPipeline: ctx.previewRpaFlowPipeline,
        executeRpaFlowPipeline: ctx.executeRpaFlowPipeline,
        simulateFlow: ctx.simulateFlow,
        sessionEvents: ctx.sessionEvents,
        saveSessionEventsToFile: ctx.saveSessionEventsToFile,
        buildConversationReplay: ctx.buildConversationReplay,
      };
    },
  });

  // Conversation
  mountExpressHandler(router, {
    handler: handleConversationRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);
      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        logger: ctx.logger,
        sessionEvents: ctx.sessionEvents,
        listChannelConversations: ctx.listChannelConversations,
        listConversationMessages: ctx.listConversationMessages,
        buildConversationReplay: ctx.buildConversationReplay,
      };
    },
  });

  return router;
}

module.exports = {
  createDomainFlowRoutes,
};
