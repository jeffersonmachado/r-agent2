'use strict';

const {
  safeTrim,
} = require('../../utils/defensiveCoercion');

function applyTicketAssignment(ticket, assignedTo) {
  ticket.status = 'in_progress';
  ticket.assignedTo = assignedTo;
  ticket.updatedAt = new Date().toISOString();

  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  ticket.messages.push({
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: `Ticket atribuido para ${assignedTo}.`,
    sender: 'system',
    timestamp: new Date().toISOString(),
  });
}

function applyTicketClosure(ticket) {
  ticket.status = 'closed';
  ticket.updatedAt = new Date().toISOString();

  const resolvedAt = new Date();
  ticket.resolvedAt = resolvedAt.toISOString();
  const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
  const firstResponseAt = ticket.firstResponseAt ? new Date(ticket.firstResponseAt) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime())) {
    if (firstResponseAt && !Number.isNaN(firstResponseAt.getTime())) {
      ticket.waitingTimeSeconds = Math.max(0, Math.round((firstResponseAt - createdAt) / 1000));
      ticket.handlingTimeSeconds = Math.max(0, Math.round((resolvedAt - firstResponseAt) / 1000));
    } else {
      ticket.waitingTimeSeconds = Math.max(0, Math.round((resolvedAt - createdAt) / 1000));
      ticket.handlingTimeSeconds = 0;
    }
  }

  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  const closeReasonName = ticket.context?.closeReason?.name || ticket.context?.closeReasonName || null;
  ticket.messages.push({
    id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: closeReasonName ? `Ticket encerrado (${closeReasonName}).` : 'Ticket encerrado.',
    sender: 'system',
    timestamp: new Date().toISOString(),
  });
}

function normalizeTransferParams(params = {}) {
  const nextQueue = params.queue != null && safeTrim(params.queue) !== ''
    ? safeTrim(params.queue)
    : null;
  const hasAssignedTo = Object.prototype.hasOwnProperty.call(params, 'assignedTo');
  const assignedTo = hasAssignedTo
    ? (params.assignedTo != null && safeTrim(params.assignedTo) !== '' ? safeTrim(params.assignedTo) : null)
    : undefined;

  return {
    nextQueue,
    hasAssignedTo,
    assignedTo,
  };
}

function applyTicketTransferMutation(ticket, { nextQueue, hasAssignedTo, assignedTo } = {}) {
  if (nextQueue && nextQueue !== ticket.queue) {
    ticket.queue = nextQueue;
  }

  if (hasAssignedTo) {
    ticket.assignedTo = assignedTo || null;
  }

  if (ticket.status !== 'closed') {
    ticket.status = ticket.assignedTo ? 'in_progress' : 'waiting';
  }

  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  const parts = [];
  if (nextQueue) parts.push(`Fila: ${nextQueue}`);
  if (hasAssignedTo) parts.push(ticket.assignedTo ? `Atribuido: ${ticket.assignedTo}` : 'Sem atendente');
  if (parts.length > 0) {
    ticket.messages.push({
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      text: `Transferencia realizada. ${parts.join(' · ')}`,
      sender: 'system',
      timestamp: new Date().toISOString(),
    });
  }

  ticket.updatedAt = new Date().toISOString();
}

function applyTicketPatch(ticket, patch = {}) {
  Object.assign(ticket, patch);
  ticket.updatedAt = new Date().toISOString();
}

module.exports = {
  applyTicketAssignment,
  applyTicketClosure,
  normalizeTransferParams,
  applyTicketTransferMutation,
  applyTicketPatch,
};