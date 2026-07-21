'use strict';

const express = require('express');

/**
 * Módulo consolidado do Agent Operating System.
 * Agrega: Agent Registry, Agent Factory, Knowledge Graph, Journey Registry,
 * RAP Learn, AI Governance, Agent Marketplace, Agent Orchestrator, Vertical Templates.
 */
function createAgentOsRoutes({ buildDeps }) {
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

  // --- Agent Registry ---
  const { handleAgentRegistryRoutes } = require('../agent-registry/routes');
  router.use(runHandled(handleAgentRegistryRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    isSuperAdmin: ctx.isSuperAdmin,
    logAction: ctx.logAction,
    logger: ctx.logger,
  })));

  // --- Agent Factory ---
  const { handleAgentFactoryRoutes } = require('./routes/agent-factory');
  router.use(runHandled(handleAgentFactoryRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    isSuperAdmin: ctx.isSuperAdmin,
    logAction: ctx.logAction,
    logger: ctx.logger,
  })));

  // --- Knowledge Graph ---
  const { handleKnowledgeGraphRoutes } = require('./routes/knowledge-graph');
  router.use(runHandled(handleKnowledgeGraphRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
  })));

  // --- Journey Registry ---
  const { handleJourneyRegistryRoutes } = require('./routes/journey-registry');
  router.use(runHandled(handleJourneyRegistryRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logAction: ctx.logAction,
    logger: ctx.logger,
  })));

  // --- RAP Learn ---
  const { handleRapLearnRoutes } = require('./routes/rap-learn');
  router.use(runHandled(handleRapLearnRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
  })));

  // --- AI Governance ---
  const { handleAiGovernanceRoutes } = require('./routes/ai-governance');
  router.use(runHandled(handleAiGovernanceRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logAction: ctx.logAction,
    logger: ctx.logger,
  })));

  // --- Agent Marketplace ---
  const { handleAgentMarketplaceRoutes } = require('./routes/agent-marketplace');
  router.use(runHandled(handleAgentMarketplaceRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
  })));

  // --- Agent Orchestrator ---
  const { handleAgentOrchestratorRoutes } = require('./routes/agent-orchestrator');
  router.use(runHandled(handleAgentOrchestratorRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
  })));

  // --- Vertical Templates ---
  const { handleVerticalTemplateRoutes } = require('./routes/vertical-templates');
  router.use(runHandled(handleVerticalTemplateRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logAction: ctx.logAction,
    logger: ctx.logger,
  })));

  return router;
}

module.exports = { createAgentOsRoutes };
