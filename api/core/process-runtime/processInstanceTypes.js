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

function createWaitingState(waitingState = {}) {
  if (!waitingState || typeof waitingState !== 'object') return null;
  return {
    type: waitingState.type ? String(waitingState.type) : null,
    resumeAt: waitingState.resumeAt || null,
    correlationKey: waitingState.correlationKey ? String(waitingState.correlationKey) : null,
    externalRef: waitingState.externalRef ? String(waitingState.externalRef) : null,
    nodeId: waitingState.nodeId ? String(waitingState.nodeId) : null,
    metadata: clone(waitingState.metadata || {}),
  };
}

function createProcessInstance(instance = {}) {
  const now = new Date().toISOString();
  return {
    executionId: String(instance.executionId || ''),
    processId: String(instance.processId || ''),
    processVersion: Number.isFinite(Number(instance.processVersion)) ? Number(instance.processVersion) : 1,
    status: String(instance.status || PROCESS_INSTANCE_STATUSES.PENDING),
    currentNodeId: instance.currentNodeId != null ? String(instance.currentNodeId) : null,
    variablesSnapshot: clone(instance.variablesSnapshot || {}),
    waitingState: createWaitingState(instance.waitingState),
    startedAt: instance.startedAt || now,
    updatedAt: instance.updatedAt || now,
    completedAt: instance.completedAt || null,
    failedAt: instance.failedAt || null,
    lastEventSequence: Number.isFinite(Number(instance.lastEventSequence)) ? Number(instance.lastEventSequence) : 0,
    metadata: clone(instance.metadata || {}),
  };
}

module.exports = {
  PROCESS_INSTANCE_STATUSES,
  PROCESS_WAITING_TYPES,
  createProcessInstance,
  createWaitingState,
};
