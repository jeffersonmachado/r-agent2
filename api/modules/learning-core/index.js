'use strict';

const express = require('express');

/**
 * Módulo do Learning Core (aprendizado de usuário).
 * Domínio separado do RAP Learn (aprendizado de máquina).
 */
function createLearningCoreRoutes({ buildDeps }) {
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

  const { handleLearningCoreRoutes } = require('./routes');
  router.use(runHandled(handleLearningCoreRoutes, (ctx) => ({
    requireAuth: ctx.requireAuth,
    sendJson: ctx.sendJson,
    badRequest: ctx.badRequest,
    hasJsonContentType: ctx.hasJsonContentType,
    parseJsonBody: ctx.parseJsonBody,
    logger: ctx.logger,
  })));

  return router;
}

module.exports = { createLearningCoreRoutes };
