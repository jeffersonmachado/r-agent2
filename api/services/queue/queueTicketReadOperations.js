'use strict';

/**
 * Read-only ticket/query operations for queue service.
 * Runtime Maps and helpers are injected as deps.
 */

function listQueue(queue, options = {}, { queues, tickets, getQueueTicketIds }) {
  const ticketIds = getQueueTicketIds(queues, queue);
  if (ticketIds.length === 0) return [];
  let ticketList = ticketIds.map((id) => tickets.get(id)).filter(Boolean);

  if (options.tenantId) {
    ticketList = ticketList.filter((t) => t.tenantId === options.tenantId);
  }

  if (options.status) {
    ticketList = ticketList.filter((t) => t.status === options.status);
  }

  ticketList.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return ticketList;
}

function listQueues({ queues }) {
  return Array.from(queues.keys());
}

function getTicket(ticketId, { tickets }) {
  return tickets.get(ticketId) || null;
}

function getTicketBySession(sessionId, tenantId, { tickets, findActiveTicketBySession }) {
  return findActiveTicketBySession({ tickets, sessionId, tenantId });
}

function getTicketByConversationId(conversationId, tenantId, { tickets, findActiveTicketByConversation }) {
  return findActiveTicketByConversation({ tickets, conversationId, tenantId });
}

function getTicketMessages(ticketId, { tickets }) {
  const ticket = tickets.get(ticketId);
  if (!ticket || !ticket.messages) return [];
  return ticket.messages;
}

function listAllTickets(options = {}, { tickets, logger, buildListAllTicketsResponse }) {
  logger.debug(`[QueueService] listAllTickets: Map tem ${tickets.size} ticket(s), Array tem ${tickets.size} ticket(s)`, {
    filters: { tenantId: options.tenantId, status: options.status, queue: options.queue, q: options.q },
  });
  return buildListAllTicketsResponse(Array.from(tickets.values()), options);
}

module.exports = {
  listQueue,
  listQueues,
  getTicket,
  getTicketBySession,
  getTicketByConversationId,
  getTicketMessages,
  listAllTickets,
};
