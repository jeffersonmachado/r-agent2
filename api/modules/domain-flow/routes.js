'use strict';

const express = require('express');
const { handleFlowCrudRoutes } = require('./handleFlowCrudRoutes');
const { handleFlowExecutionRoutes } = require('./handleFlowExecutionRoutes');
const { handleConversationRoutes } = require('./handleConversationRoutes');

function createDomainFlowRoutes({ buildDeps }) {
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

  // Flow CRUD
  router.use(runHandled(handleFlowCrudRoutes, (ctx) => ({
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
  })));

  // Flow Execution
  router.use(runHandled(handleFlowExecutionRoutes, (ctx) => ({
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
  })));

  // Conversation
  router.use(runHandled(handleConversationRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    logger: ctx.logger,
    sessionEvents: ctx.sessionEvents,
    listChannelConversations: ctx.listChannelConversations,
    listConversationMessages: ctx.listConversationMessages,
    buildConversationReplay: ctx.buildConversationReplay,
  })));

  return router;
}

module.exports = {
  createDomainFlowRoutes,
};
