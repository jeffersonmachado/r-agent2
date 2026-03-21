'use strict';

const express = require('express');
const { handleChannelWebhookRoutes } = require('./handleChannelWebhookRoutes');

function createChannelWebhookRoutes({ buildDeps }) {
  const router = express.Router();

  router.use(async (req, res, next) => {
    try {
      const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
      const handled = await handleChannelWebhookRoutes({
        req,
        res,
        method: (req.method || 'GET').toUpperCase(),
        pathname,
        deps: buildDeps(req, res),
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
  createChannelWebhookRoutes,
};
