'use strict';

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

function isSafeObjectRecord(value) {
  if (!value || typeof value !== 'object') return false;
  try {
    return !Array.isArray(value);
  } catch (_) {
    return false;
  }
}

function isSafeArray(value) {
  try {
    return Array.isArray(value);
  } catch (_) {
    return false;
  }
}

class ProcessExecutionContext {
  constructor({
    processId,
    processVersion = 1,
    executionId,
    currentNodeId = null,
    variables = {},
    history = [],
    startTime = null,
    status = 'pending',
    waitingState = null,
    lastProcessedSequence = 0,
    metadata = {},
    recovery = {},
  } = {}) {
    this.processId = String(processId || '');
    this.processVersion = Number.isFinite(Number(processVersion)) ? Number(processVersion) : 1;
    this.executionId = String(executionId || '');
    this.currentNodeId = currentNodeId != null ? String(currentNodeId) : null;
    this.variables = isSafeObjectRecord(variables) ? (safeClone(variables) ?? {}) : {};
    this.history = isSafeArray(history) ? (safeClone(history) ?? []) : [];
    this.startTime = startTime ? String(startTime) : new Date().toISOString();
    this.status = String(status || 'running');
    this.waitingState = isSafeObjectRecord(waitingState) ? (safeClone(waitingState) ?? null) : null;
    this.lastProcessedSequence = Number.isFinite(Number(lastProcessedSequence)) ? Number(lastProcessedSequence) : 0;
    this.metadata = isSafeObjectRecord(metadata) ? (safeClone(metadata) ?? {}) : {};
    this.recovery = isSafeObjectRecord(recovery) ? (safeClone(recovery) ?? {}) : {};
  }

  getVariable(name, fallbackValue = undefined) {
    const key = String(name || '');
    if (!key) return fallbackValue;
    return Object.prototype.hasOwnProperty.call(this.variables, key)
      ? this.variables[key]
      : fallbackValue;
  }

  setVariable(name, value) {
    const key = String(name || '');
    if (!key) return value;
    this.variables[key] = value;
    return value;
  }

  pushHistory(entry) {
    let payload;
    if (isSafeObjectRecord(entry)) {
      payload = safeClone(entry) ?? { value: entry };
    } else {
      payload = { value: entry };
    }
    const timestamp = safeGet(payload, 'timestamp') || new Date().toISOString();
    const historyEntry = { ...payload, timestamp };
    this.history.push(historyEntry);
    return this.history[this.history.length - 1];
  }

  getCurrentNode(compiledProcess) {
    if (!compiledProcess || !this.currentNodeId) return null;
    try {
      const graph = compiledProcess.executionGraph;
      if (!graph) return null;
      return safeGet(graph.nodesById, this.currentNodeId, null);
    } catch (_) {
      return null;
    }
  }

  moveToNode(nodeId) {
    this.currentNodeId = nodeId != null ? String(nodeId) : null;
    return this.currentNodeId;
  }

  setWaitingState(waitingState) {
    this.waitingState = isSafeObjectRecord(waitingState) ? (safeClone(waitingState) ?? null) : null;
    if (this.waitingState) {
      this.status = 'waiting';
    }
    return this.waitingState;
  }

  clearWaitingState() {
    this.waitingState = null;
    return this.waitingState;
  }

  canResume() {
    return this.status === 'waiting' && !!this.waitingState;
  }

  getLastHistoryEntry() {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  toSnapshot() {
    return {
      processId: this.processId,
      processVersion: this.processVersion,
      executionId: this.executionId,
      currentNodeId: this.currentNodeId,
      variables: safeClone(this.variables) ?? {},
      history: safeClone(this.history) ?? [],
      startTime: this.startTime,
      status: this.status,
      waitingState: this.waitingState ? (safeClone(this.waitingState) ?? null) : null,
      lastProcessedSequence: this.lastProcessedSequence,
      metadata: safeClone(this.metadata) ?? {},
      recovery: safeClone(this.recovery) ?? {},
    };
  }

  toJSON() {
    return this.toSnapshot();
  }

  static fromSnapshot(snapshot = {}) {
    return new ProcessExecutionContext(snapshot);
  }
}

module.exports = {
  ProcessExecutionContext,
};
