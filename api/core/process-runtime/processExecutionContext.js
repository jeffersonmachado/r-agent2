'use strict';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
    this.variables = variables && typeof variables === 'object' ? clone(variables) : {};
    this.history = Array.isArray(history) ? clone(history) : [];
    this.startTime = startTime || new Date().toISOString();
    this.status = String(status || 'running');
    this.waitingState = waitingState && typeof waitingState === 'object' ? clone(waitingState) : null;
    this.lastProcessedSequence = Number.isFinite(Number(lastProcessedSequence)) ? Number(lastProcessedSequence) : 0;
    this.metadata = metadata && typeof metadata === 'object' ? clone(metadata) : {};
    this.recovery = recovery && typeof recovery === 'object' ? clone(recovery) : {};
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
    const payload = entry && typeof entry === 'object' ? clone(entry) : { value: entry };
    this.history.push({
      ...payload,
      timestamp: payload.timestamp || new Date().toISOString(),
    });
    return this.history[this.history.length - 1];
  }

  getCurrentNode(compiledProcess) {
    if (!compiledProcess || !compiledProcess.executionGraph || !this.currentNodeId) return null;
    return compiledProcess.executionGraph.nodesById[this.currentNodeId] || null;
  }

  moveToNode(nodeId) {
    this.currentNodeId = nodeId != null ? String(nodeId) : null;
    return this.currentNodeId;
  }

  setWaitingState(waitingState) {
    this.waitingState = waitingState && typeof waitingState === 'object' ? clone(waitingState) : null;
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
      variables: clone(this.variables),
      history: clone(this.history),
      startTime: this.startTime,
      status: this.status,
      waitingState: this.waitingState ? clone(this.waitingState) : null,
      lastProcessedSequence: this.lastProcessedSequence,
      metadata: clone(this.metadata),
      recovery: clone(this.recovery),
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
