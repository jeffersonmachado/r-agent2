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

function getQueueStats({ tickets, queues, queueName }) {
  const ticketIds = getQueueTicketIds(queues, queueName);
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