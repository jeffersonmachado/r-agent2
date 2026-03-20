'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { handleAgentRoutes } = require('../../serverHandlers/agentRoutes');
const { handleAuditRoutes } = require('../../serverHandlers/auditRoutes');

function createDomainIdentityRoutes({ buildDeps }) {
  const router = express.Router();

  // Agent
  mountExpressHandler(router, {
    handler: handleAgentRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);
      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        badRequest: ctx.badRequest,
        hasJsonContentType: ctx.hasJsonContentType,
        parseJsonBody: ctx.parseJsonBody,
        listAgents: ctx.listAgents,
        createAgent: ctx.createAgent,
        getAgent: ctx.getAgent,
        updateAgent: ctx.updateAgent,
        deleteAgent: ctx.deleteAgent,
        inviteUser: ctx.inviteUser,
        acceptInvitation: ctx.acceptInvitation,
        requestPasswordReset: ctx.requestPasswordReset,
        resetPassword: ctx.resetPassword,
        setupMfa: ctx.setupMfa,
        verifyMfa: ctx.verifyMfa,
        disableMfa: ctx.disableMfa,
        consumeRecoveryCode: ctx.consumeRecoveryCode,
        isSuperAdmin: ctx.isSuperAdmin,
        logAction: ctx.logAction,
        logger: ctx.logger,
      };
    },
  });

  // Audit
  mountExpressHandler(router, {
    handler: handleAuditRoutes,
    buildDeps: (req, res) => {
      const ctx = buildDeps(req, res);
      return {
        requireAuth: ctx.requireAuth,
        requirePermission: ctx.requirePermission,
        sendJson: ctx.sendJson,
        queryLogs: ctx.queryLogs,
        getAuditStats: ctx.getAuditStats,
      };
    },
  });

  return router;
}

module.exports = {
  createDomainIdentityRoutes,
};
