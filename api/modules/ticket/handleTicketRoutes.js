'use strict';

const { handleTicketCoreRoutes } = require('./tickets/ticketCoreRoutes');
const { handleTicketLifecycleRoutes } = require('./tickets/ticketLifecycleRoutes');
const { handleTicketCommunicationRoutes } = require('./tickets/ticketCommunicationRoutes');
const { handleTicketOperationsRoutes } = require('./tickets/ticketOperationsRoutes');

async function handleTicketRoutes({ req, res, method, pathname, deps }) {
  if (!pathname.startsWith('/tickets') && pathname !== '/close-reasons' && pathname !== '/queues/reload' && pathname !== '/metrics/queues') {
    return false;
  }

  if (await handleTicketCoreRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleTicketLifecycleRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleTicketCommunicationRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleTicketOperationsRoutes({ req, res, method, pathname, deps })) return true;

  return false;
}

module.exports = {
  handleTicketRoutes,
};
