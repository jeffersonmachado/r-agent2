'use strict';

const { ProcessExecutionContext } = require('./processExecutionContext');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class ProcessReplayService {
  rebuildContextFromInstance(instance) {
    return ProcessExecutionContext.fromSnapshot({
      processId: instance.processId,
      processVersion: instance.processVersion || 1,
      executionId: instance.executionId,
      currentNodeId: instance.currentNodeId,
      variables: clone(instance.variablesSnapshot || {}),
      history: clone(instance.metadata?.history || []),
      status: instance.status,
      waitingState: clone(instance.waitingState || null),
      startTime: instance.startedAt,
      metadata: clone(instance.metadata || {}),
      lastProcessedSequence: instance.lastEventSequence || 0,
      recovery: {
        from: 'instance',
        updatedAt: instance.updatedAt || null,
      },
    });
  }

  rebuildContextFromEvents(compiledProcess, events = []) {
    const firstEvent = events[0] || {};
    const context = new ProcessExecutionContext({
      processId: compiledProcess?.id || '',
      processVersion: compiledProcess?.version || firstEvent.processVersion || 1,
      executionId: firstEvent.executionId || '',
      currentNodeId: compiledProcess?.executionGraph?.startNode || null,
      status: 'pending',
      variables: {},
      history: [],
      metadata: {},
      startTime: firstEvent.timestamp || null,
    });
    return this.replayToSequence(compiledProcess, events, Number.MAX_SAFE_INTEGER, context);
  }

  replayToSequence(compiledProcess, events = [], targetSequence = Number.MAX_SAFE_INTEGER, seedContext = null) {
    const context = seedContext || new ProcessExecutionContext({
      processId: compiledProcess?.id || '',
      executionId: events[0]?.executionId || '',
      currentNodeId: compiledProcess?.executionGraph?.startNode || null,
    });
    const ordered = events
      .slice()
      .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0))
      .filter((event) => Number(event.sequence || 0) <= Number(targetSequence));

    ordered.forEach((event) => {
      context.lastProcessedSequence = Number(event.sequence || 0);
      switch (event.eventType) {
        case 'PROCESS_STARTED':
        case 'PROCESS_RESUMED':
          context.status = 'running';
          context.processVersion = Number(event.processVersion || context.processVersion || 1);
          if (event.metadata && typeof event.metadata === 'object') {
            context.metadata = {
              ...(context.metadata || {}),
              ...clone(event.metadata),
            };
          }
          break;
        case 'NODE_ENTER':
          if (event.nodeId != null) {
            context.currentNodeId = String(event.nodeId);
          }
          if (event.payload?.variablesSnapshot) {
            context.variables = clone(event.payload.variablesSnapshot);
          }
          if (Array.isArray(event.payload?.historySnapshot)) {
            context.history = clone(event.payload.historySnapshot);
          }
          break;
        case 'NODE_EXIT':
        case 'NODE_WAITING':
        case 'NODE_RESUMED':
        case 'NODE_ERROR':
        case 'GATEWAY_DECISION':
          if (event.payload?.variablesSnapshot) {
            context.variables = clone(event.payload.variablesSnapshot);
          }
          if (Array.isArray(event.payload?.historySnapshot)) {
            context.history = clone(event.payload.historySnapshot);
          }
          if (Object.prototype.hasOwnProperty.call(event.payload || {}, 'currentNodeId')) {
            context.currentNodeId = event.payload.currentNodeId != null ? String(event.payload.currentNodeId) : null;
          }
          if (event.payload?.waitingState) {
            context.setWaitingState(event.payload.waitingState);
          }
          if (event.eventType === 'NODE_RESUMED') {
            context.clearWaitingState();
            context.status = 'running';
          }
          if (event.eventType === 'NODE_WAITING') {
            context.status = 'waiting';
          }
          if (event.eventType === 'NODE_EXIT') {
            context.clearWaitingState();
            context.status = 'running';
            if (Object.prototype.hasOwnProperty.call(event.payload || {}, 'nextNodeId')) {
              context.currentNodeId = event.payload.nextNodeId != null ? String(event.payload.nextNodeId) : null;
            }
          }
          if (event.eventType === 'NODE_ERROR') {
            context.status = 'failed';
          }
          break;
        case 'PROCESS_COMPLETED':
          context.status = 'completed';
          context.currentNodeId = null;
          context.clearWaitingState();
          break;
        case 'PROCESS_FAILED':
          context.status = 'failed';
          break;
        case 'PROCESS_CANCELLED':
          context.status = 'cancelled';
          break;
        default:
          break;
      }
    });

    return context;
  }

  getExecutionPath(events = []) {
    return events
      .filter((event) => ['NODE_ENTER', 'NODE_EXIT', 'NODE_WAITING', 'NODE_RESUMED'].includes(event.eventType))
      .map((event) => ({
        sequence: event.sequence,
        nodeId: event.nodeId,
        nodeType: event.nodeType,
        eventType: event.eventType,
        timestamp: event.timestamp,
      }));
  }

  getCurrentStateFromEvents(compiledProcess, events = []) {
    return this.rebuildContextFromEvents(compiledProcess, events).toSnapshot();
  }
}

module.exports = {
  ProcessReplayService,
};
