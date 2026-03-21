'use strict';

const express = require('express');
const { handleAgentRoutes } = require('./handleAgentRoutes');
const { handleAuditRoutes } = require('./handleAuditRoutes');

function createDomainIdentityRoutes({ buildDeps }) {
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

  // Agent
  router.use(runHandled(handleAgentRoutes, (ctx) => ({
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
  })));

  // Audit
  router.use(runHandled(handleAuditRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    requirePermission: ctx.requirePermission,
    sendJson: ctx.sendJson,
    queryLogs: ctx.queryLogs,
    getAuditStats: ctx.getAuditStats,
  })));

  return router;
}

module.exports = {
  createDomainIdentityRoutes,
};
