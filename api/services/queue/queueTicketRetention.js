'use strict';

function cleanupOldTickets({ tickets, maxAgeDays = 7, onDeleteTicket }) {
  const now = Date.now();
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const [ticketId, ticket] of tickets.entries()) {
    if (ticket.status !== 'closed') continue;
    const ticketAge = now - new Date(ticket.updatedAt).getTime();
    if (ticketAge <= maxAge) continue;

    tickets.delete(ticketId);
    if (typeof onDeleteTicket === 'function') {
      onDeleteTicket(ticketId);
    }
    cleaned++;
  }

  return cleaned;
}

function startAutoCleanup({ intervalHours = 1, maxAgeDays = 7, runCleanup }) {
  const intervalMs = intervalHours * 60 * 60 * 1000;

  if (typeof runCleanup === 'function') {
    runCleanup(maxAgeDays);
  }

  const intervalId = setInterval(() => {
    if (typeof runCleanup === 'function') {
      runCleanup(maxAgeDays);
    }
  }, intervalMs);

  if (typeof intervalId.unref === 'function') {
    intervalId.unref();
  }

  return intervalId;
}

module.exports = {
  cleanupOldTickets,
  startAutoCleanup,
};