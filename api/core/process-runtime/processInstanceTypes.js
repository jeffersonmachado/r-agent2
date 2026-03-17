'use strict';

const PROCESS_INSTANCE_STATUSES = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  WAITING: 'waiting',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const PROCESS_WAITING_TYPES = Object.freeze({
  TIMER: 'timer',
  MESSAGE: 'message',
  HUMAN: 'human',
  SUBPROCESS: 'subprocess',
  EXTERNAL_EVENT: 'external_event',
});

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

function safeFiniteNumber(value, fallbackValue = 0) {
  try {
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : fallbackValue;
  } catch (_) {
    return fallbackValue;
  }
}

function isRecord(value) {
  return !!(value && typeof value === 'object');
}

function normalizeOptionalString(value) {
  if (value == null) return null;
  const normalized = safeToString(value, '');
  return normalized || null;
}

function createWaitingState(waitingState = {}) {
  if (!isRecord(waitingState)) return null;
  const metadata = safeClone(safeGet(waitingState, 'metadata', {}), {}) ?? {};
  const normalized = {
    type: normalizeOptionalString(safeGet(waitingState, 'type', null)),
    resumeAt: safeGet(waitingState, 'resumeAt', null),
    correlationKey: normalizeOptionalString(safeGet(waitingState, 'correlationKey', null)),
    externalRef: normalizeOptionalString(safeGet(waitingState, 'externalRef', null)),
    nodeId: normalizeOptionalString(safeGet(waitingState, 'nodeId', null)),
    metadata,
  };
  if (!normalized.type && !normalized.resumeAt && !normalized.correlationKey && !normalized.externalRef && !normalized.nodeId && Object.keys(metadata).length === 0) {
    return null;
  }
  return normalized;
}

function createProcessInstance(instance = {}) {
  const safeInstance = isRecord(instance) ? instance : {};
  const now = new Date().toISOString();
  return {
    executionId: safeToString(safeGet(safeInstance, 'executionId', ''), ''),
    processId: safeToString(safeGet(safeInstance, 'processId', ''), ''),
    processVersion: safeFiniteNumber(safeGet(safeInstance, 'processVersion', 1), 1),
    status: normalizeOptionalString(safeGet(safeInstance, 'status', null)) || PROCESS_INSTANCE_STATUSES.PENDING,
    currentNodeId: safeGet(safeInstance, 'currentNodeId', null) != null ? safeToString(safeGet(safeInstance, 'currentNodeId'), null) : null,
    variablesSnapshot: safeClone(safeGet(safeInstance, 'variablesSnapshot', {}), {}) ?? {},
    waitingState: createWaitingState(safeGet(safeInstance, 'waitingState', null)),
    startedAt: safeGet(safeInstance, 'startedAt', now) || now,
    updatedAt: safeGet(safeInstance, 'updatedAt', now) || now,
    completedAt: safeGet(safeInstance, 'completedAt', null),
    failedAt: safeGet(safeInstance, 'failedAt', null),
    lastEventSequence: safeFiniteNumber(safeGet(safeInstance, 'lastEventSequence', 0), 0),
    metadata: safeClone(safeGet(safeInstance, 'metadata', {}), {}) ?? {},
  };
}

module.exports = {
  PROCESS_INSTANCE_STATUSES,
  PROCESS_WAITING_TYPES,
  createProcessInstance,
  createWaitingState,
};
