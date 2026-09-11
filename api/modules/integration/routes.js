'use strict';

const express = require('express');
const { handleIntegrationWebhookRoutes } = require('./handleIntegrationWebhookRoutes');

function createIntegrationRoutes({ buildDeps }) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
      const handled = await handleIntegrationWebhookRoutes({
        req,
        res,
        method: (req.method || 'GET').toUpperCase(),
        pathname,
        deps: buildDeps(req, res),
      });
      if (!handled && !res.writableEnded) next();
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createIntegrationRoutes };
