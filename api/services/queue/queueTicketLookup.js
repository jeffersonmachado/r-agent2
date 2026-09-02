'use strict';

const { safeToString } = require('../../utils/defensiveCoercion');

function findActiveTicketBySession({ tickets, sessionId, tenantId = null, lookupIndex = null }) {
  const effectiveSessionId = sessionId ? safeToString(sessionId) : null;
  if (!effectiveSessionId) return null;

  // Caminho indexado: O(1) por (tenant, session) em vez de varrer todos os
  // tickets de todos os tenants. As checagens duras abaixo preservam
  // exatamente a semântica do scan (status ativo + match exato + tenant).
  if (lookupIndex && tenantId) {
    const tenantBucket = lookupIndex.bySession.get(safeToString(tenantId));
    const candidates = tenantBucket ? tenantBucket.get(effectiveSessionId) : null;
    if (!candidates) return null;
    for (const ticketId of candidates) {
      const ticket = tickets.get(ticketId);
      if (!ticket || ticket.status === 'closed') continue;
      if (ticket.sessionId !== effectiveSessionId) continue;
      if (ticket.tenantId !== tenantId) continue;
      return ticket;
    }
    return null;
  }

  for (const ticket of tickets.values()) {
    if (!ticket || ticket.status === 'closed') continue;
    if (ticket.sessionId !== effectiveSessionId) continue;
    if (tenantId && ticket.tenantId !== tenantId) continue;
    return ticket;
  }
  return null;
}

function findActiveTicketByConversation({ tickets, conversationId, tenantId, lookupIndex = null }) {
  const convId = conversationId ? safeToString(conversationId) : null;
  const tId = tenantId ? safeToString(tenantId) : null;
  if (!convId || !tId) return null;

  // Caminho indexado (tenantId é obrigatório aqui): mesmo desempate do scan —
  // primeiro ticket ativo na ordem de inserção do bucket.
  if (lookupIndex) {
    const tenantBucket = lookupIndex.byConversation.get(tId);
    const candidates = tenantBucket ? tenantBucket.get(convId) : null;
    if (!candidates) return null;
    for (const ticketId of candidates) {
      const ticket = tickets.get(ticketId);
      if (!ticket || ticket.status === 'closed') continue;
      if (ticket.tenantId !== tId) continue;
      if (ticket.conversationId === convId) return ticket;
    }
    return null;
  }

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
