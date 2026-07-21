'use strict';

const express = require('express');
const { handleCognitiveRoutes } = require('../../modules/cognitive/routes');

function createCognitiveExpressRouter({ buildCoreRoutingContext }) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
      const ctx = buildCoreRoutingContext(req, res);
      const handled = await handleCognitiveRoutes({
        req,
        res,
        method: (req.method || 'GET').toUpperCase(),
        pathname,
        deps: {
          requireAuth: ctx.requireAuth,
          requirePermission: ctx.requirePermission,
          sendJson: ctx.sendJson,
          badRequest: ctx.badRequest,
          hasJsonContentType: ctx.hasJsonContentType,
          parseJsonBody: ctx.parseJsonBody,
        },
      });
      if (!handled && !res.writableEnded) {
        next();
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = {
  createCognitiveExpressRouter,
};
