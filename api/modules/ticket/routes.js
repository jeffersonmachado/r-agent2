'use strict';

const express = require('express');
const { mountExpressHandler } = require('../shared/expressHandlerBridge');
const { handleTicketCoreRoutes } = require('../../serverHandlers/tickets/ticketCoreRoutes');
const { handleTicketLifecycleRoutes } = require('../../serverHandlers/tickets/ticketLifecycleRoutes');
const { handleTicketCommunicationRoutes } = require('../../serverHandlers/tickets/ticketCommunicationRoutes');
const { handleTicketOperationsRoutes } = require('../../serverHandlers/tickets/ticketOperationsRoutes');

function createTicketRoutes({ buildDeps }) {
  const router = express.Router();

  mountExpressHandler(router, {
    handler: handleTicketCoreRoutes,
    buildDeps,
  });

  mountExpressHandler(router, {
    handler: handleTicketLifecycleRoutes,
    buildDeps,
  });

  mountExpressHandler(router, {
    handler: handleTicketCommunicationRoutes,
    buildDeps,
  });

  mountExpressHandler(router, {
    handler: handleTicketOperationsRoutes,
    buildDeps,
  });

  return router;
}

module.exports = {
  createTicketRoutes,
};
