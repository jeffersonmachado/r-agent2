'use strict';

const DEDUP_TTL_MS = 5 * 60 * 1000;
const notifiedByMessageKey = new Map();

function shouldNotifyTicketMessage(ticket) {
  if (!ticket || typeof ticket !== 'object') return false;
  if (ticket.status === 'closed') return false;
  const mode = String(ticket.mode || 'bot');
  return mode === 'human' || mode === 'paused';
}

function selectRecipientUserIdsForTicket(ticket) {
  if (!ticket || !ticket.assignedTo) return [];
  return [String(ticket.assignedTo)];
}

function consumeMessageDedup({ tenantId, ticketId, externalMessageId }) {
  if (!externalMessageId) return { duplicate: false };

  const now = Date.now();
  for (const [key, expiresAt] of notifiedByMessageKey.entries()) {
    if (expiresAt <= now) notifiedByMessageKey.delete(key);
  }

  const dedupKey = `${String(tenantId)}::${String(ticketId)}::${String(externalMessageId)}`;
  const existing = notifiedByMessageKey.get(dedupKey);
  if (existing && existing > now) {
    return { duplicate: true };
  }

  notifiedByMessageKey.set(dedupKey, now + DEDUP_TTL_MS);
  return { duplicate: false };
}

function clearDedupCacheForTests() {
  notifiedByMessageKey.clear();
}

module.exports = {
  shouldNotifyTicketMessage,
  selectRecipientUserIdsForTicket,
  consumeMessageDedup,
  clearDedupCacheForTests,
};
