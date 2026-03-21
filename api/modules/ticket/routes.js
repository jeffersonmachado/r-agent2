'use strict';

const express = require('express');
const { handleTicketCoreRoutes } = require('./tickets/ticketCoreRoutes');
const { handleTicketLifecycleRoutes } = require('./tickets/ticketLifecycleRoutes');
const { handleTicketCommunicationRoutes } = require('./tickets/ticketCommunicationRoutes');
const { handleTicketOperationsRoutes } = require('./tickets/ticketOperationsRoutes');

function createTicketRoutes({ buildDeps }) {
  const router = express.Router();

  function runHandled(handler) {
    return async (req, res, next) => {
      try {
        const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
        const handled = await handler({
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

  router.use(runHandled(handleTicketCoreRoutes));
  router.use(runHandled(handleTicketLifecycleRoutes));
  router.use(runHandled(handleTicketCommunicationRoutes));
  router.use(runHandled(handleTicketOperationsRoutes));

  return router;
}

module.exports = {
  createTicketRoutes,
};
