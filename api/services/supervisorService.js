const { listAllTickets, listQueues } = require('./queueService');
const { listAgents } = require('./authService');
const queueDefinitionService = require('./queueDefinitionService');
const { getConnectedAgentsByTenant } = require('./websocketService');

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toPeriodKey(date, period) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  if (period === 'hour') {
    return `${iso.slice(0, 13)}:00`;
  }
  return iso.slice(0, 10);
}

function computeFirstResponseSeconds(ticket) {
  if (!ticket) return null;
  if (Number.isFinite(ticket.waitingTimeSeconds) && ticket.waitingTimeSeconds >= 0) {
    return ticket.waitingTimeSeconds;
  }
  const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
  if (ticket.firstResponseAt && createdAt && !Number.isNaN(createdAt.getTime())) {
    const first = new Date(ticket.firstResponseAt);
    if (!Number.isNaN(first.getTime())) {
      return Math.max(0, Math.round((first - createdAt) / 1000));
    }
  }
  if (Array.isArray(ticket.messages) && ticket.messages.length > 0) {
    const userMsg = ticket.messages.find((m) => m && m.sender === 'user' && m.timestamp);
    const agentMsg = ticket.messages.find((m) => m && m.sender === 'agent' && m.timestamp);
    if (userMsg && agentMsg) {
      const userTime = new Date(userMsg.timestamp);
      const agentTime = new Date(agentMsg.timestamp);
      if (!Number.isNaN(userTime.getTime()) && !Number.isNaN(agentTime.getTime())) {
        return Math.max(0, Math.round((agentTime - userTime) / 1000));
      }
    }
  }
  return null;
}

function computeHandlingSeconds(ticket) {
  if (!ticket) return null;
  if (Number.isFinite(ticket.handlingTimeSeconds) && ticket.handlingTimeSeconds >= 0) {
    return ticket.handlingTimeSeconds;
  }
  if (ticket.resolvedAt && ticket.firstResponseAt) {
    const resolved = new Date(ticket.resolvedAt);
    const first = new Date(ticket.firstResponseAt);
    if (!Number.isNaN(resolved.getTime()) && !Number.isNaN(first.getTime())) {
      return Math.max(0, Math.round((resolved - first) / 1000));
    }
  }
  return null;
}

async function getSupervisorMetrics({ tenantId, groupBy = 'agent', period = 'day', from, to }) {
  const allTickets = listAllTickets({ tenantId });
  let tickets = Array.isArray(allTickets.tickets) ? allTickets.tickets : [];

  const startDate = parseDate(from);
  const endDate = parseDate(to);

  if (startDate || endDate) {
    tickets = tickets.filter((ticket) => {
      const createdAt = new Date(ticket.createdAt);
      if (Number.isNaN(createdAt.getTime())) return false;
      if (startDate && createdAt < startDate) return false;
      if (endDate && createdAt > endDate) return false;
      return true;
    });
  }

  const effectiveGroupBy = groupBy === 'queue' ? 'queue' : 'agent';
  const effectivePeriod = period === 'hour' ? 'hour' : 'day';

  const agentsRaw = await listAgents(tenantId);
  const agents = Array.isArray(agentsRaw)
    ? agentsRaw
    : (agentsRaw && Array.isArray(agentsRaw.agents) ? agentsRaw.agents : []);
  const agentNameMap = new Map(agents.map((a) => [String(a.id), a.name || a.username || a.email || a.id]));

  const accumulator = new Map();

  for (const ticket of tickets) {
    if (!ticket) continue;
    const createdAt = ticket.createdAt ? new Date(ticket.createdAt) : null;
    const periodKey = createdAt ? toPeriodKey(createdAt, effectivePeriod) : null;
    if (!periodKey) continue;

    const groupKey = effectiveGroupBy === 'queue'
      ? (ticket.queue ? String(ticket.queue) : 'unknown')
      : (ticket.assignedTo ? String(ticket.assignedTo) : 'unassigned');

    const mapKey = `${periodKey}::${groupKey}`;
    if (!accumulator.has(mapKey)) {
      accumulator.set(mapKey, {
        period: periodKey,
        groupKey,
        groupLabel: effectiveGroupBy === 'queue'
          ? groupKey
          : (agentNameMap.get(groupKey) || groupKey),
        totalTickets: 0,
        closedTickets: 0,
        openTickets: 0,
        waitingTickets: 0,
        inProgressTickets: 0,
        firstResponseSum: 0,
        firstResponseCount: 0,
        handlingSum: 0,
        handlingCount: 0,
        abandonedClosed: 0,
      });
    }

    const stat = accumulator.get(mapKey);
    stat.totalTickets += 1;

    if (ticket.status === 'closed') {
      stat.closedTickets += 1;
    } else {
      stat.openTickets += 1;
      if (ticket.status === 'waiting') stat.waitingTickets += 1;
      if (ticket.status === 'in_progress') stat.inProgressTickets += 1;
    }

    const firstResponseSeconds = computeFirstResponseSeconds(ticket);
    if (Number.isFinite(firstResponseSeconds)) {
      stat.firstResponseSum += firstResponseSeconds;
      stat.firstResponseCount += 1;
    }

    if (ticket.status === 'closed') {
      if (!ticket.firstResponseAt) stat.abandonedClosed += 1;
      const handlingSeconds = computeHandlingSeconds(ticket);
      if (Number.isFinite(handlingSeconds)) {
        stat.handlingSum += handlingSeconds;
        stat.handlingCount += 1;
      }
    }
  }

  const items = Array.from(accumulator.values()).map((stat) => {
    const avgFirstResponseTimeSeconds = stat.firstResponseCount
      ? Math.round(stat.firstResponseSum / stat.firstResponseCount)
      : null;
    const avgHandlingTimeSeconds = stat.handlingCount
      ? Math.round(stat.handlingSum / stat.handlingCount)
      : null;
    const abandonmentRate = stat.closedTickets > 0
      ? Number((stat.abandonedClosed / stat.closedTickets).toFixed(4))
      : 0;

    return {
      period: stat.period,
      groupKey: stat.groupKey,
      groupLabel: stat.groupLabel,
      totalTickets: stat.totalTickets,
      closedTickets: stat.closedTickets,
      openTickets: stat.openTickets,
      waitingTickets: stat.waitingTickets,
      inProgressTickets: stat.inProgressTickets,
      avgFirstResponseTimeSeconds,
      avgHandlingTimeSeconds,
      abandonmentRate,
    };
  });

  items.sort((a, b) => {
    if (a.period !== b.period) return a.period < b.period ? 1 : -1;
    return b.totalTickets - a.totalTickets;
  });

  return {
    groupBy: effectiveGroupBy,
    period: effectivePeriod,
    from: startDate ? startDate.toISOString() : null,
    to: endDate ? endDate.toISOString() : null,
    items,
  };
}

async function getSupervisorAgentStatus({ tenantId }) {
  const agentsRaw = await listAgents(tenantId);
  const agents = Array.isArray(agentsRaw)
    ? agentsRaw
    : (agentsRaw && Array.isArray(agentsRaw.agents) ? agentsRaw.agents : []);

  const allTickets = listAllTickets({ tenantId });
  const tickets = Array.isArray(allTickets.tickets) ? allTickets.tickets : [];

  const connected = getConnectedAgentsByTenant(tenantId);

  return agents.map((agent) => {
    const agentId = String(agent.id);
    const agentTickets = tickets.filter((t) => t && t.assignedTo && String(t.assignedTo) === agentId && t.status !== 'closed');
    const inProgress = agentTickets.filter((t) => t.status === 'in_progress');
    const waiting = agentTickets.filter((t) => t.status === 'waiting');

    const connection = connected.get(agentId) || null;
    const isOnline = !!connection;
    const status = isOnline
      ? (inProgress.length > 0 ? 'busy' : 'online')
      : 'offline';

    return {
      agentId,
      agentName: agent.name || agent.username || agent.email || agentId,
      status,
      activeTickets: agentTickets.length,
      inProgressTickets: inProgress.length,
      waitingTickets: waiting.length,
      lastActivity: connection ? connection.lastActivity : null,
    };
  });
}

function getSupervisorQueueStatus({ tenantId }) {
  const allTickets = listAllTickets({ tenantId });
  const tickets = Array.isArray(allTickets.tickets) ? allTickets.tickets : [];

  const queueNames = new Set();
  for (const t of tickets) {
    if (t && t.queue) queueNames.add(String(t.queue));
  }

  try {
    for (const q of queueDefinitionService.listQueues({ tenantId, activeOnly: false })) {
      if (q?.name) queueNames.add(String(q.name));
    }
  } catch (_) {}

  try {
    for (const q of (listQueues() || [])) queueNames.add(String(q));
  } catch (_) {}

  const result = [];

  for (const queueName of Array.from(queueNames.values())) {
    const queueTickets = tickets.filter((t) => t && t.queue === queueName);
    const waitingTickets = queueTickets.filter((t) => t.status === 'waiting');
    const inProgressTickets = queueTickets.filter((t) => t.status === 'in_progress');
    const closedTickets = queueTickets.filter((t) => t.status === 'closed');

    let oldestWaitingAt = null;
    for (const t of waitingTickets) {
      if (!t.createdAt) continue;
      const created = new Date(t.createdAt);
      if (Number.isNaN(created.getTime())) continue;
      if (!oldestWaitingAt || created < oldestWaitingAt) oldestWaitingAt = created;
    }

    result.push({
      queueName,
      totalTickets: queueTickets.length,
      activeTickets: waitingTickets.length + inProgressTickets.length,
      waitingTickets: waitingTickets.length,
      inProgressTickets: inProgressTickets.length,
      closedTickets: closedTickets.length,
      oldestWaitingAt: oldestWaitingAt ? oldestWaitingAt.toISOString() : null,
    });
  }

  result.sort((a, b) => b.activeTickets - a.activeTickets);
  return result;
}

module.exports = {
  getSupervisorMetrics,
  getSupervisorAgentStatus,
  getSupervisorQueueStatus,
};
