'use strict';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentile(values = [], fraction = 0.95) {
  const sorted = values
    .map((value) => safeNumber(value, NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length * fraction)) - 1));
  return sorted[index];
}

function getTimestamp(event) {
  const timestamp = new Date(event?.timestamp || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function groupByExecution(events = []) {
  const grouped = new Map();
  events.forEach((event) => {
    const executionId = String(event?.executionId || '');
    if (!executionId) return;
    if (!grouped.has(executionId)) grouped.set(executionId, []);
    grouped.get(executionId).push(event);
  });
  grouped.forEach((items, key) => {
    grouped.set(key, items.slice().sort((a, b) => {
      const sequenceDiff = safeNumber(a?.sequence, 0) - safeNumber(b?.sequence, 0);
      if (sequenceDiff !== 0) return sequenceDiff;
      return getTimestamp(a) - getTimestamp(b);
    }));
  });
  return grouped;
}

function buildExecutionSummary(events = []) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const ordered = events.slice().sort((a, b) => safeNumber(a?.sequence, 0) - safeNumber(b?.sequence, 0));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const startedAt = getTimestamp(first);
  const finishedAt = getTimestamp(last);
  const durationMs = startedAt > 0 && finishedAt >= startedAt ? finishedAt - startedAt : 0;
  const terminal = ordered.find((event) => ['PROCESS_COMPLETED', 'PROCESS_FAILED', 'PROCESS_CANCELLED'].includes(String(event?.eventType || '')))
    || last;
  const status = terminal?.eventType === 'PROCESS_COMPLETED'
    ? 'completed'
    : terminal?.eventType === 'PROCESS_FAILED'
      ? 'failed'
      : terminal?.eventType === 'PROCESS_CANCELLED'
        ? 'cancelled'
        : 'running';

  return {
    executionId: String(first.executionId || ''),
    processId: String(first.processId || ''),
    processVersion: safeNumber(first.processVersion, 1),
    startedAt: first.timestamp || null,
    finishedAt: last.timestamp || null,
    durationMs,
    status,
  };
}

class ProcessAnalyticsService {
  buildExecutionSummaries(events = []) {
    return Array.from(groupByExecution(events).values())
      .map((items) => buildExecutionSummary(items))
      .filter(Boolean);
  }

  getProcessMetrics(events = []) {
    const executions = this.buildExecutionSummaries(events);
    const totalExecutions = executions.length;
    const completed = executions.filter((item) => item.status === 'completed').length;
    const failed = executions.filter((item) => item.status === 'failed').length;
    const durations = executions
      .filter((item) => ['completed', 'failed', 'cancelled'].includes(item.status))
      .map((item) => item.durationMs);

    return {
      totalExecutions,
      successRate: totalExecutions > 0 ? completed / totalExecutions : 0,
      failureRate: totalExecutions > 0 ? failed / totalExecutions : 0,
      averageDurationMs: durations.length > 0 ? durations.reduce((acc, value) => acc + value, 0) / durations.length : 0,
      p95DurationMs: percentile(durations, 0.95),
      executions,
    };
  }

  getNodeMetrics(events = []) {
    const nodeStats = new Map();
    const pendingEnterByExecutionNode = new Map();

    const ordered = events.slice().sort((a, b) => {
      const sequenceDiff = safeNumber(a?.sequence, 0) - safeNumber(b?.sequence, 0);
      if (sequenceDiff !== 0) return sequenceDiff;
      return getTimestamp(a) - getTimestamp(b);
    });

    ordered.forEach((event) => {
      const nodeId = event?.nodeId ? String(event.nodeId) : null;
      if (!nodeId) return;
      if (!nodeStats.has(nodeId)) {
        nodeStats.set(nodeId, {
          nodeId,
          nodeType: event?.nodeType ? String(event.nodeType) : null,
          entries: 0,
          exits: 0,
          errors: 0,
          fallbacks: 0,
          totalDurationMs: 0,
          averageDurationMs: 0,
        });
      }
      const stat = nodeStats.get(nodeId);
      const key = `${String(event.executionId || '')}:${nodeId}`;

      if (event.eventType === 'NODE_ENTER') {
        stat.entries += 1;
        pendingEnterByExecutionNode.set(key, getTimestamp(event));
      }
      if (event.eventType === 'NODE_EXIT') {
        stat.exits += 1;
      }
      if (event.eventType === 'NODE_ERROR') {
        stat.errors += 1;
      }
      if (event.eventType === 'NODE_FALLBACK') {
        stat.fallbacks += 1;
      }

      if (['NODE_EXIT', 'NODE_WAITING', 'NODE_ERROR', 'NODE_TIMEOUT'].includes(String(event.eventType || ''))) {
        const startedAt = pendingEnterByExecutionNode.get(key);
        if (Number.isFinite(startedAt)) {
          stat.totalDurationMs += Math.max(0, getTimestamp(event) - startedAt);
          pendingEnterByExecutionNode.delete(key);
        }
      }
    });

    return Array.from(nodeStats.values()).map((stat) => ({
      ...stat,
      averageDurationMs: stat.entries > 0 ? stat.totalDurationMs / stat.entries : 0,
    }));
  }

  getGatewayMetrics(events = []) {
    const gateways = new Map();
    events
      .filter((event) => event?.eventType === 'GATEWAY_DECISION')
      .forEach((event) => {
        const nodeId = String(event.nodeId || '');
        if (!nodeId) return;
        if (!gateways.has(nodeId)) {
          gateways.set(nodeId, {
            nodeId,
            nodeType: event?.nodeType ? String(event.nodeType) : 'gateway.exclusive',
            totalDecisions: 0,
            pathDistribution: {},
          });
        }
        const stat = gateways.get(nodeId);
        const chosenNext = String(event?.payload?.chosenNext || 'unknown');
        stat.totalDecisions += 1;
        stat.pathDistribution[chosenNext] = safeNumber(stat.pathDistribution[chosenNext], 0) + 1;
      });
    return Array.from(gateways.values()).map((item) => clone(item));
  }

  buildAnalytics(events = []) {
    return {
      process: this.getProcessMetrics(events),
      nodes: this.getNodeMetrics(events),
      gateways: this.getGatewayMetrics(events),
    };
  }
}

module.exports = {
  ProcessAnalyticsService,
  buildExecutionSummary,
};
