'use strict';

/**
 * Índice secundário do ticket store (hot path de mensagens inbound).
 *
 * findActiveTicketBySession/findActiveTicketByConversation varriam o Map
 * global de tickets (todos os tenants) a cada mensagem. Este índice mantém
 * Map<tenantId, Map<sessionId|conversationId, ticketId[]>> atualizado nos
 * mesmos pontos de mutação do store (create/update/hydrate/retention).
 *
 * Invariantes:
 * - As listas por bucket preservam a ordem de inserção (o desempate "primeiro
 *   ticket ativo" é idêntico ao scan sequencial do Map).
 * - Tickets fechados permanecem indexados; o lookup checa `status` no ticket
 *   (fonte da verdade continua sendo o Map principal).
 * - ticketKeys (reverse index) permite reindexar/remover sem varrer buckets.
 */

const { safeToString } = require('../../utils/defensiveCoercion');

function createTicketLookupIndex() {
  return {
    bySession: new Map(), // tenantId -> Map<sessionId, ticketId[]>
    byConversation: new Map(), // tenantId -> Map<conversationId, ticketId[]>
    ticketKeys: new Map(), // ticketId -> { tenantId, sessionId, conversationId }
  };
}

function addToBucket(map, tenantId, key, ticketId) {
  let tenantBucket = map.get(tenantId);
  if (!tenantBucket) {
    tenantBucket = new Map();
    map.set(tenantId, tenantBucket);
  }
  let list = tenantBucket.get(key);
  if (!list) {
    list = [];
    tenantBucket.set(key, list);
  }
  if (!list.includes(ticketId)) list.push(ticketId);
}

function removeFromBucket(map, tenantId, key, ticketId) {
  if (!tenantId || !key) return;
  const tenantBucket = map.get(tenantId);
  if (!tenantBucket) return;
  const list = tenantBucket.get(key);
  if (!list) return;
  const pos = list.indexOf(ticketId);
  if (pos >= 0) list.splice(pos, 1);
  if (list.length === 0) tenantBucket.delete(key);
  if (tenantBucket.size === 0) map.delete(tenantId);
}

function unindexTicket(index, ticketId) {
  if (!index || !ticketId) return false;
  const keys = index.ticketKeys.get(ticketId);
  if (!keys) return false;
  removeFromBucket(index.bySession, keys.tenantId, keys.sessionId, ticketId);
  removeFromBucket(index.byConversation, keys.tenantId, keys.conversationId, ticketId);
  index.ticketKeys.delete(ticketId);
  return true;
}

function indexTicket(index, ticket) {
  if (!index || !ticket || !ticket.id) return false;
  // Reindex idempotente: remove entradas anteriores (sessionId/conversationId
  // podem ter mudado em updateTicket/hydrate).
  unindexTicket(index, ticket.id);

  const tenantId = safeToString(ticket.tenantId, '');
  const sessionId = ticket.sessionId ? safeToString(ticket.sessionId) : null;
  const conversationId = ticket.conversationId ? safeToString(ticket.conversationId) : null;

  if (tenantId && sessionId) addToBucket(index.bySession, tenantId, sessionId, ticket.id);
  if (tenantId && conversationId) addToBucket(index.byConversation, tenantId, conversationId, ticket.id);
  index.ticketKeys.set(ticket.id, { tenantId, sessionId, conversationId });
  return true;
}

function clearTicketLookupIndex(index) {
  if (!index) return;
  index.bySession.clear();
  index.byConversation.clear();
  index.ticketKeys.clear();
}

module.exports = {
  createTicketLookupIndex,
  indexTicket,
  unindexTicket,
  clearTicketLookupIndex,
};
