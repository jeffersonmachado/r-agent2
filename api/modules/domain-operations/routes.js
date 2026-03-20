'use strict';

const express = require('express');
const { createInboxRoutes } = require('../inbox/routes');
const { createSchedulingSupportRoutes } = require('../scheduling-support/routes');
const { createSupervisorRoutes } = require('../supervisor/routes');
const { createTaskRoutes } = require('../task/routes');

function createDomainOperationsRoutes({ buildDeps }) {
  const router = express.Router();

  router.use(createTaskRoutes({
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

  router.use(createSchedulingSupportRoutes({
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
  }));

  router.use(createInboxRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        listAllTickets: ctx.listAllTickets,
        getTicket: ctx.getTicket,
        canAccessTicket: ctx.canAccessTicket,
        canModifyTicket: ctx.canModifyTicket,
        assignTicket: ctx.assignTicket,
        transferTicket: ctx.transferTicket,
        addTicketNote: ctx.addTicketNote,
        triggerWebhooks: ctx.triggerWebhooks,
        emitEvent: ctx.emitEvent,
        logAction: ctx.logAction,
        logger: ctx.logger,
      };
    },
  }));

  router.use(createSupervisorRoutes({
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);

      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        requireTenant: ctx.requireTenant,
        sendJson: ctx.sendJson,
        logger: ctx.logger,
        getSupervisorMetrics: ctx.getSupervisorMetrics,
        getGeneralMetrics: ctx.getGeneralMetrics,
        getSupervisorAgentStatus: ctx.getSupervisorAgentStatus,
        getSupervisorQueueStatus: ctx.getSupervisorQueueStatus,
      };
    },
  }));

  return router;
}

module.exports = {
  createDomainOperationsRoutes,
};
