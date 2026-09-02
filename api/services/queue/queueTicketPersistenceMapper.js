'use strict';

const { safeToString } = require('../../utils/defensiveCoercion');

function normalizeTicketMode(mode) {
  return mode === 'bot' || mode === 'human' || mode === 'paused' ? mode : null;
}

function toDbPayload(ticket) {
  return {
    id: ticket.id,
    tenant_key: ticket.tenantId,
    session_id: ticket.sessionId,
    conversation_id: ticket.conversationId || null,
    channel_type: ticket.channelType || null,
    queue: ticket.queue,
    status: ticket.status,
    mode: normalizeTicketMode(ticket.mode),
    pause_reason: ticket.pauseReason || null,
    takeover_at: ticket.takeoverAt ? new Date(ticket.takeoverAt) : null,
    return_to_bot_at: ticket.returnToBotAt ? new Date(ticket.returnToBotAt) : null,
    takeover_reason: ticket.takeoverReason || null,
    return_reason: ticket.returnReason || null,
    first_response_at: ticket.firstResponseAt ? new Date(ticket.firstResponseAt) : null,
    resolved_at: ticket.resolvedAt ? new Date(ticket.resolvedAt) : null,
    waiting_time_seconds: Number.isFinite(ticket.waitingTimeSeconds) ? ticket.waitingTimeSeconds : null,
    handling_time_seconds: Number.isFinite(ticket.handlingTimeSeconds) ? ticket.handlingTimeSeconds : null,
    assigned_to: ticket.assignedTo || null,
    phone_number: ticket.phoneNumber || null,
    last_user_message: ticket.lastUserMessage || null,
    unread_count: Number.isFinite(ticket.unreadCount) ? ticket.unreadCount : 0,
    tags: Array.isArray(ticket.tags) ? ticket.tags : [],
    category: ticket.category || null,
    messages: Array.isArray(ticket.messages) ? ticket.messages : [],
    context: ticket.context || {},
  };
}

function fromDbRow(row) {
  return {
    id: row.id,
    tenantId: row.tenant_key,
    sessionId: row.session_id,
    conversationId: row.conversation_id || null,
    channelType: row.channel_type || (row.session_id && safeToString(row.session_id, '').startsWith('whatsapp_') ? 'whatsapp' : null),
    queue: row.queue,
    status: row.status,
    mode: normalizeTicketMode(row.mode),
    pauseReason: row.pause_reason || null,
    takeoverAt: row.takeover_at ? new Date(row.takeover_at).toISOString() : null,
    returnToBotAt: row.return_to_bot_at ? new Date(row.return_to_bot_at).toISOString() : null,
    takeoverReason: row.takeover_reason || null,
    returnReason: row.return_reason || null,
    firstResponseAt: row.first_response_at ? new Date(row.first_response_at).toISOString() : null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    waitingTimeSeconds: Number.isFinite(row.waiting_time_seconds) ? row.waiting_time_seconds : null,
    handlingTimeSeconds: Number.isFinite(row.handling_time_seconds) ? row.handling_time_seconds : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt?.toISOString?.() || new Date().toISOString()),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt?.toISOString?.() || new Date().toISOString()),
    lastUserMessage: row.last_user_message || null,
    assignedTo: row.assigned_to || null,
    phoneNumber: row.phone_number || null,
    messages: Array.isArray(row.messages) ? row.messages : [],
    unreadCount: Number.isFinite(row.unread_count) ? row.unread_count : 0,
    tags: Array.isArray(row.tags) ? row.tags : [],
    category: row.category || null,
    context: row.context || {},
  };
}

function upsertTicketInRuntimeCache({ row, tickets, queues, lookupIndex = null, indexTicket = null }) {
  if (!row) return null;
  const ticket = fromDbRow(row);
  if (!ticket?.id) return null;

  tickets.set(ticket.id, ticket);
  if (typeof indexTicket === 'function' && lookupIndex) {
    indexTicket(lookupIndex, ticket);
  }
  if (!queues.has(ticket.queue)) queues.set(ticket.queue, new Set());
  queues.get(ticket.queue).add(ticket.id);

  return ticket;
}

module.exports = {
  toDbPayload,
  fromDbRow,
  upsertTicketInRuntimeCache,
};
