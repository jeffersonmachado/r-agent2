'use strict';

const { ProcessExecutionContext } = require('./processExecutionContext');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeClone(value, fallbackValue = null) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallbackValue;
  }
}

function safeGet(value, key, fallbackValue = undefined) {
  try {
    const result = value?.[key];
    return result === undefined ? fallbackValue : result;
  } catch (_) {
    return fallbackValue;
  }
}

function safeToString(value, fallbackValue = '') {
  try {
    return String(value);
  } catch (_) {
    return fallbackValue;
  }
}

function safeNumber(value, fallbackValue = 0) {
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : fallbackValue;
}

function safeIsArray(value) {
  try {
    return Array.isArray(value);
  } catch (_) {
    return false;
  }
}

function safeArrayCopy(value) {
  if (!safeIsArray(value)) return [];
  try {
    return value.slice();
  } catch (_) {
    return [];
  }
}

function safeHasOwn(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch (_) {
    return false;
  }
}

class ProcessReplayService {
  rebuildContextFromInstance(instance) {
    const metadata = safeClone(safeGet(instance, 'metadata', {}), {}) ?? {};
    return ProcessExecutionContext.fromSnapshot({
      processId: safeToString(safeGet(instance, 'processId', ''), ''),
      processVersion: safeNumber(safeGet(instance, 'processVersion', 1), 1),
      executionId: safeToString(safeGet(instance, 'executionId', ''), ''),
      currentNodeId: safeGet(instance, 'currentNodeId', null),
      variables: safeClone(safeGet(instance, 'variablesSnapshot', {}), {}) ?? {},
      history: safeClone(safeGet(metadata, 'history', []), []) ?? [],
      status: safeToString(safeGet(instance, 'status', 'pending'), 'pending'),
      waitingState: safeClone(safeGet(instance, 'waitingState', null), null),
      startTime: safeGet(instance, 'startedAt', null),
      metadata,
      lastProcessedSequence: safeNumber(safeGet(instance, 'lastEventSequence', 0), 0),
      recovery: {
        from: 'instance',
        updatedAt: safeGet(instance, 'updatedAt', null),
      },
    });
  }

  rebuildContextFromEvents(compiledProcess, events = []) {
    const safeEvents = safeArrayCopy(events);
    const firstEvent = safeEvents[0] || {};
    const context = new ProcessExecutionContext({
      processId: safeToString(safeGet(compiledProcess, 'id', ''), ''),
      processVersion: safeNumber(safeGet(compiledProcess, 'version') || safeGet(firstEvent, 'processVersion', 1), 1),
      executionId: safeToString(safeGet(firstEvent, 'executionId', ''), ''),
      currentNodeId: safeGet(safeGet(compiledProcess, 'executionGraph', null), 'startNode', null),
      status: 'pending',
      variables: {},
      history: [],
      metadata: {},
      startTime: safeGet(firstEvent, 'timestamp', null),
    });
    return this.replayToSequence(compiledProcess, safeEvents, Number.MAX_SAFE_INTEGER, context);
  }

  replayToSequence(compiledProcess, events = [], targetSequence = Number.MAX_SAFE_INTEGER, seedContext = null) {
    const safeEvents = safeArrayCopy(events);
    const context = seedContext || new ProcessExecutionContext({
      processId: safeToString(safeGet(compiledProcess, 'id', ''), ''),
      executionId: safeToString(safeGet(safeEvents[0], 'executionId', ''), ''),
      currentNodeId: safeGet(safeGet(compiledProcess, 'executionGraph', null), 'startNode', null),
    });
    const ordered = safeEvents
      .slice()
      .sort((a, b) => safeNumber(safeGet(a, 'sequence', 0), 0) - safeNumber(safeGet(b, 'sequence', 0), 0))
      .filter((event) => safeNumber(safeGet(event, 'sequence', 0), 0) <= safeNumber(targetSequence, Number.MAX_SAFE_INTEGER));

    ordered.forEach((event) => {
      const payload = safeGet(event, 'payload', null);
      const metadata = safeGet(event, 'metadata', null);
      const eventType = safeToString(safeGet(event, 'eventType', ''), '');
      context.lastProcessedSequence = safeNumber(safeGet(event, 'sequence', 0), 0);
      switch (eventType) {
        case 'PROCESS_STARTED':
        case 'PROCESS_RESUMED':
          context.status = 'running';
          context.processVersion = safeNumber(safeGet(event, 'processVersion', context.processVersion || 1), context.processVersion || 1);
          if (metadata && typeof metadata === 'object') {
            context.metadata = {
              ...(context.metadata || {}),
              ...(safeClone(metadata, {}) || {}),
            };
          }
          break;
        case 'NODE_ENTER':
          if (safeGet(event, 'nodeId') != null) {
            context.currentNodeId = safeToString(safeGet(event, 'nodeId'), null);
          }
          if (safeGet(payload, 'variablesSnapshot')) {
            context.variables = safeClone(safeGet(payload, 'variablesSnapshot'), {}) ?? {};
          }
          if (safeIsArray(safeGet(payload, 'historySnapshot'))) {
            context.history = safeClone(safeGet(payload, 'historySnapshot'), []) ?? [];
          }
          break;
        case 'NODE_EXIT':
        case 'NODE_WAITING':
        case 'NODE_RESUMED':
        case 'NODE_ERROR':
        case 'GATEWAY_DECISION':
          if (safeGet(payload, 'variablesSnapshot')) {
            context.variables = safeClone(safeGet(payload, 'variablesSnapshot'), {}) ?? {};
          }
          if (safeIsArray(safeGet(payload, 'historySnapshot'))) {
            context.history = safeClone(safeGet(payload, 'historySnapshot'), []) ?? [];
          }
          if (safeHasOwn(payload || {}, 'currentNodeId')) {
            context.currentNodeId = safeGet(payload, 'currentNodeId') != null ? safeToString(safeGet(payload, 'currentNodeId'), null) : null;
          }
          if (safeGet(payload, 'waitingState')) {
            context.setWaitingState(safeGet(payload, 'waitingState'));
          }
          if (eventType === 'NODE_RESUMED') {
            context.clearWaitingState();
            context.status = 'running';
          }
          if (eventType === 'NODE_WAITING') {
            context.status = 'waiting';
          }
          if (eventType === 'NODE_EXIT') {
            context.clearWaitingState();
            context.status = 'running';
            if (safeHasOwn(payload || {}, 'nextNodeId')) {
              context.currentNodeId = safeGet(payload, 'nextNodeId') != null ? safeToString(safeGet(payload, 'nextNodeId'), null) : null;
            }
          }
          if (eventType === 'NODE_ERROR') {
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
    return safeArrayCopy(events)
      .filter((event) => ['NODE_ENTER', 'NODE_EXIT', 'NODE_WAITING', 'NODE_RESUMED'].includes(safeToString(safeGet(event, 'eventType', ''), '')))
      .map((event) => ({
        sequence: safeGet(event, 'sequence', 0),
        nodeId: safeGet(event, 'nodeId', null),
        nodeType: safeGet(event, 'nodeType', null),
        eventType: safeToString(safeGet(event, 'eventType', ''), ''),
        timestamp: safeGet(event, 'timestamp', null),
      }));
  }

  getCurrentStateFromEvents(compiledProcess, events = []) {
    return this.rebuildContextFromEvents(compiledProcess, events).toSnapshot();
  }
}

module.exports = {
  ProcessReplayService,
};
