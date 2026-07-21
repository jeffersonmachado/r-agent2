'use strict';

const express = require('express');
const { handleAgentRegistryRoutes } = require('./routes');

function createAgentRegistryRoutes({ buildDeps }) {
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

  return router;
}

module.exports = {
  createAgentRegistryRoutes,
};
