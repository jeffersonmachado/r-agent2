'use strict';

const { safeToString } = require('../../utils/defensiveCoercion');

function findActiveTicketBySession({ tickets, sessionId, tenantId = null }) {
  const effectiveSessionId = sessionId ? safeToString(sessionId) : null;
  if (!effectiveSessionId) return null;

  for (const ticket of tickets.values()) {
    if (!ticket || ticket.status === 'closed') continue;
    if (ticket.sessionId !== effectiveSessionId) continue;
    if (tenantId && ticket.tenantId !== tenantId) continue;
    return ticket;
  }
  return null;
}

function findActiveTicketByConversation({ tickets, conversationId, tenantId }) {
  const convId = conversationId ? safeToString(conversationId) : null;
  const tId = tenantId ? safeToString(tenantId) : null;
  if (!convId || !tId) return null;

  for (const ticket of tickets.values()) {
    if (!ticket || ticket.status === 'closed') continue;
    if (ticket.tenantId !== tId) continue;
    if (ticket.conversationId === convId) return ticket;
  }
  return null;
}

module.exports = {
  findActiveTicketBySession,
  findActiveTicketByConversation,
};