function ensureQueueIndex(queues, queueName) {
  if (!queues.has(queueName)) {
    queues.set(queueName, new Set());
  }
  return queues.get(queueName);
}

function addTicketToQueueIndex({ queues, queueName, ticketId }) {
  if (!queueName || !ticketId) return false;
  const queueSet = ensureQueueIndex(queues, queueName);
  queueSet.add(ticketId);
  return true;
}

function removeTicketFromQueueIndex({ queues, queueName, ticketId, deleteWhenEmpty = false }) {
  if (!queueName || !ticketId) return false;
  const queueSet = queues.get(queueName);
  if (!queueSet) return false;
  const removed = queueSet.delete(ticketId);
  if (deleteWhenEmpty && queueSet.size === 0) {
    queues.delete(queueName);
  }
  return removed;
}

function moveTicketAcrossQueueIndexes({ queues, ticketId, fromQueue, toQueue }) {
  if (!ticketId || !fromQueue || !toQueue || fromQueue === toQueue) return false;
  removeTicketFromQueueIndex({ queues, queueName: fromQueue, ticketId });
  addTicketToQueueIndex({ queues, queueName: toQueue, ticketId });
  return true;
}

function getQueueTicketIds(queues, queueName) {
  const queueSet = queues.get(queueName);
  if (!queueSet) return [];
  return Array.from(queueSet);
}

function getQueueStats({ tickets, queues, queueName, tenantId = null }) {
  const allTicketIds = getQueueTicketIds(queues, queueName);
  // ESCOPO DE TENANT (P0 de isolamento, 2026-10-20). O índice é chaveado só por
  // nome de fila; sem este filtro, uma exclusão forçada do tenant A fechava
  // tickets do tenant B que estivessem na mesma fila nominal.
  const ticketIds = tenantId
    ? allTicketIds.filter((id) => {
      const ticket = tickets.get(id);
      return ticket && String(ticket.tenantId || '') === String(tenantId);
    })
    : allTicketIds;
  let activeTickets = 0;
  let closedTickets = 0;

  ticketIds.forEach((id) => {
    const ticket = tickets.get(id);
    if (!ticket) return;
    if (ticket.status === 'closed') {
      closedTickets++;
    } else {
      activeTickets++;
    }
  });

  return {
    ticketIds,
    ticketCount: ticketIds.length,
    activeTickets,
    closedTickets,
  };
}

module.exports = {
  ensureQueueIndex,
  addTicketToQueueIndex,
  removeTicketFromQueueIndex,
  moveTicketAcrossQueueIndexes,
  getQueueTicketIds,
  getQueueStats,
};