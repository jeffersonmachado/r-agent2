'use strict';

function buildTicketMetrics({ tickets, logger, memoryUsageProvider }) {
  const allTickets = Array.from(tickets.values());
  const now = Date.now();
  const maxAge7Days = 7 * 24 * 60 * 60 * 1000;
  const maxAge30Days = 30 * 24 * 60 * 60 * 1000;

  const metrics = {
    totalTickets: allTickets.length,
    ticketsByStatus: {
      waiting: 0,
      in_progress: 0,
      closed: 0,
    },
    ticketsByQueue: {},
    oldClosedTickets: {
      olderThan7Days: 0,
      olderThan30Days: 0,
    },
    oldestTicket: null,
    newestTicket: null,
    memoryUsage: typeof memoryUsageProvider === 'function' ? memoryUsageProvider() : {},
  };

  let oldestDate = Infinity;
  let newestDate = 0;

  allTickets.forEach((ticket) => {
    if (!ticket || !ticket.id) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[QueueService] Ticket invalido encontrado no Map:', ticket);
      }
      return;
    }

    if (ticket.status && (ticket.status === 'waiting' || ticket.status === 'in_progress' || ticket.status === 'closed')) {
      metrics.ticketsByStatus[ticket.status] = (metrics.ticketsByStatus[ticket.status] || 0) + 1;
    } else if (ticket.status) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`[QueueService] Ticket com status invalido: ${ticket.status}`, { ticketId: ticket.id });
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn('[QueueService] Ticket sem status:', { ticketId: ticket.id, ticket });
    }

    if (ticket.queue) {
      metrics.ticketsByQueue[ticket.queue] = (metrics.ticketsByQueue[ticket.queue] || 0) + 1;
    }

    if (ticket.status === 'closed') {
      const ticketAge = now - new Date(ticket.updatedAt).getTime();
      if (ticketAge > maxAge7Days) {
        metrics.oldClosedTickets.olderThan7Days++;
      }
      if (ticketAge > maxAge30Days) {
        metrics.oldClosedTickets.olderThan30Days++;
      }
    }

    const createdAt = new Date(ticket.createdAt).getTime();
    if (createdAt < oldestDate) {
      oldestDate = createdAt;
      metrics.oldestTicket = {
        id: ticket.id,
        createdAt: ticket.createdAt,
        ageDays: Math.floor((now - createdAt) / (24 * 60 * 60 * 1000)),
      };
    }
    if (createdAt > newestDate) {
      newestDate = createdAt;
      metrics.newestTicket = {
        id: ticket.id,
        createdAt: ticket.createdAt,
        ageDays: Math.floor((now - createdAt) / (24 * 60 * 60 * 1000)),
      };
    }
  });

  return metrics;
}

module.exports = {
  buildTicketMetrics,
};