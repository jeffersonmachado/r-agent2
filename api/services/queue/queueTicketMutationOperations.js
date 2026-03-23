'use strict';

function assignTicket(ticketId, assignedTo, { tickets, applyTicketAssignment, persistTicketBestEffort }) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  applyTicketAssignment(ticket, assignedTo);
  persistTicketBestEffort(ticket);
  return ticket;
}

function closeTicket(ticketId, {
  tickets,
  queues,
  applyTicketClosure,
  removeTicketFromQueueIndex,
  persistTicketBestEffort,
  updateConversationForTicket,
  closeOrderIncidentFromTicket,
}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  applyTicketClosure(ticket);
  removeTicketFromQueueIndex({ queues, queueName: ticket.queue, ticketId });
  persistTicketBestEffort(ticket);

  updateConversationForTicket(ticket, {
    status: 'bot',
    current_ticket_id: null,
    last_message_at: new Date(),
  }).catch(() => {});

  closeOrderIncidentFromTicket(ticket);
  return ticket;
}

function updateTicket(ticketId, patch = {}, {
  tickets,
  queues,
  safeToString,
  moveTicketAcrossQueueIndexes,
  applyTicketPatch,
  persistTicketBestEffort,
}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  const nextQueue = patch && patch.queue ? safeToString(patch.queue) : null;
  const prevQueue = ticket.queue ? safeToString(ticket.queue) : null;

  if (nextQueue && prevQueue && nextQueue !== prevQueue) {
    moveTicketAcrossQueueIndexes({ queues, ticketId, fromQueue: prevQueue, toQueue: nextQueue });
  }

  applyTicketPatch(ticket, patch);
  persistTicketBestEffort(ticket);
  return ticket;
}

function updateLastMessage(ticketId, message, externalMessageId, timestampOverride, {
  tickets,
  appendUserMessage,
  persistTicketBestEffort,
}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  const { changed } = appendUserMessage(ticket, { message, externalMessageId, timestampOverride });
  if (changed) {
    persistTicketBestEffort(ticket);
  }
  return ticket;
}

function addAgentMessage(ticketId, message, agentId, options, {
  tickets,
  appendAgentMessage,
  persistTicketBestEffort,
}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  appendAgentMessage(ticket, { message, agentId, options });
  persistTicketBestEffort(ticket);
  return ticket;
}

function addTicketNote(ticketId, note, author, {
  tickets,
  appendTicketNote,
  persistTicketBestEffort,
}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  const { changed } = appendTicketNote(ticket, { note, author });
  if (changed) {
    persistTicketBestEffort(ticket);
  }
  return ticket;
}

function transferTicket(ticketId, params = {}, {
  tickets,
  queues,
  safeToString,
  normalizeTransferParams,
  moveTicketAcrossQueueIndexes,
  addTicketToQueueIndex,
  applyTicketTransferMutation,
  persistTicketBestEffort,
}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  const { nextQueue, hasAssignedTo, assignedTo } = normalizeTransferParams(params);
  if (!nextQueue && !hasAssignedTo) {
    return ticket;
  }

  if (nextQueue && nextQueue !== ticket.queue) {
    const prevQueue = ticket.queue ? safeToString(ticket.queue) : null;
    if (prevQueue) {
      moveTicketAcrossQueueIndexes({ queues, ticketId, fromQueue: prevQueue, toQueue: nextQueue });
    } else {
      addTicketToQueueIndex({ queues, queueName: nextQueue, ticketId });
    }
  }

  applyTicketTransferMutation(ticket, { nextQueue, hasAssignedTo, assignedTo });
  persistTicketBestEffort(ticket);
  return ticket;
}

function updateOutboundMessageMeta(ticketId, patch = {}, {
  tickets,
  applyOutboundMessageMeta,
  persistTicketBestEffort,
}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  const { changed } = applyOutboundMessageMeta(ticket, patch);
  if (!changed) return ticket;

  persistTicketBestEffort(ticket);
  return ticket;
}

function markMessagesAsRead(ticketId, {
  tickets,
  resetUnreadCount,
  persistTicketBestEffort,
}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  resetUnreadCount(ticket);
  persistTicketBestEffort(ticket);
  return ticket;
}

function setTicketMode(ticketId, params = {}, {
  tickets,
  applyTicketMode,
  persistTicketBestEffort,
  updateConversationForTicket,
}) {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;

  const { conversationPatch } = applyTicketMode(ticket, params);
  persistTicketBestEffort(ticket);
  updateConversationForTicket(ticket, conversationPatch).catch(() => {});
  return ticket;
}

module.exports = {
  assignTicket,
  closeTicket,
  updateTicket,
  updateLastMessage,
  addAgentMessage,
  addTicketNote,
  transferTicket,
  updateOutboundMessageMeta,
  markMessagesAsRead,
  setTicketMode,
};
