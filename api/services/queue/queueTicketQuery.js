'use strict';

const {
  safeToString,
  safeTrim,
  safeTrimLower,
} = require('../../utils/defensiveCoercion');

function buildListAllTicketsResponse(ticketSource = [], options = {}) {
  let ticketList = Array.isArray(ticketSource) ? ticketSource.slice() : [];

  if (options.tenantId) {
    ticketList = ticketList.filter((t) => t.tenantId === options.tenantId);
  }

  if (options.status) {
    const statusList = safeTrimLower(options.status)
      .split(',')
      .map((s) => safeTrim(s))
      .filter((s) => s);
    if (statusList.length > 0) {
      ticketList = ticketList.filter((t) => statusList.includes(t.status));
    }
  }

  if (options.queue) {
    ticketList = ticketList.filter((t) => t.queue === options.queue);
  }

  if (options.q) {
    const query = safeTrimLower(options.q);
    ticketList = ticketList.filter((t) => {
      const id = safeTrimLower(safeToString(t.id || ''));
      const contact = safeTrimLower(safeToString(t.contact || ''));
      const phone = safeTrimLower(safeToString(t.phone || ''));
      const firstName = safeTrimLower(safeToString(t.firstName || ''));
      const lastName = safeTrimLower(safeToString(t.lastName || ''));
      const queue = safeTrimLower(safeToString(t.queue || ''));

      return (
        id.includes(query)
        || contact.includes(query)
        || phone.includes(query)
        || firstName.includes(query)
        || lastName.includes(query)
        || queue.includes(query)
      );
    });
  }

  ticketList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const total = ticketList.length;
  const limit = Math.min(
    Math.max(1, parseInt(options.limit, 10) || 1000),
    10000,
  );

  let offset = 0;
  if (options.cursor) {
    offset = Math.max(0, parseInt(options.cursor, 10) || 0);
  } else if (options.offset !== undefined) {
    offset = Math.max(0, parseInt(options.offset, 10) || 0);
  }

  const paginatedTickets = ticketList.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;
  const nextCursor = hasMore ? safeToString(nextOffset) : null;

  return {
    items: paginatedTickets,
    tickets: paginatedTickets,
    total,
    limit,
    offset,
    nextCursor,
    hasMore,
  };
}

module.exports = {
  buildListAllTicketsResponse,
};