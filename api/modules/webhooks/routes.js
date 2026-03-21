'use strict';

const express = require('express');
const { handleWebhooksRoutes } = require('./handleWebhooksRoutes');

function createWebhooksRoutes({ buildDeps }) {
  const router = express.Router();

  function runHandled(pathnameBuilder) {
    return async (req, res, next) => {
      try {
        const pathname = typeof pathnameBuilder === 'function' ? pathnameBuilder(req) : pathnameBuilder;
        const handled = await handleWebhooksRoutes({
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
    };
  }

  router.get('/webhooks/events', runHandled('/webhooks/events'));
  router.get('/webhooks', runHandled('/webhooks'));
  router.get('/webhooks/:webhookId', runHandled((req) => `/webhooks/${encodeURIComponent(req.params.webhookId)}`));
  router.post('/webhooks', runHandled('/webhooks'));
  router.put('/webhooks/:webhookId', runHandled((req) => `/webhooks/${encodeURIComponent(req.params.webhookId)}`));
  router.delete('/webhooks/:webhookId', runHandled((req) => `/webhooks/${encodeURIComponent(req.params.webhookId)}`));

  return router;
}

module.exports = {
  createWebhooksRoutes,
};
