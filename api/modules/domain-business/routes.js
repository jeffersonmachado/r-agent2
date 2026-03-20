'use strict';

const express = require('express');
const { createAutomationRoutes } = require('../automation/routes');
const { createDeveloperKeyRoutes } = require('../developer-key/routes');
const { createMarketingRoutes } = require('../marketing/routes');
const { createOrderRoutes } = require('../order/routes');
const { createProcessRuntimeRoutes } = require('../process-runtime/routes');
const { createRagDocumentsRoutes } = require('../rag-documents/routes');
const { createRbacRoutes } = require('../rbac/routes');
const { createSlaRoutes } = require('../sla/routes');
const { createSolutionRoutes } = require('../solution/routes');

function createDomainBusinessRoutes({ buildDeps }) {
  const router = express.Router();

  router.use(createRagDocumentsRoutes({
    buildDeps: (req, res) => buildDeps(req, res).ragRouteContext,
  }));

  router.use(createRbacRoutes({
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
        getRoleDefinitions: ctx.getRoleDefinitions,
        createRole: ctx.createRole,
        listPermissions: ctx.listPermissions,
        getAgent: ctx.getAgent,
        updateAgent: ctx.updateAgent,
      };
    },
  }));

  router.use(createProcessRuntimeRoutes({
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
      };
    },
  }));

  router.use(createMarketingRoutes({
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
      };
    },
  }));

  router.use(createOrderRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        createTicket: ctx.createTicket,
        getTicket: ctx.getTicket,
        logger: ctx.logger,
      };
    },
  }));

  router.use(createAutomationRoutes({
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
      };
    },
  }));

  router.use(createDeveloperKeyRoutes({
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
        logAction: ctx.logAction,
      };
    },
  }));

  router.use(createSolutionRoutes({
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
      };
    },
  }));

  router.use(createSlaRoutes({
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
      };
    },
  }));

  return router;
}

module.exports = {
  createDomainBusinessRoutes,
};
