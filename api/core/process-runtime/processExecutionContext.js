'use strict';

class ProcessExecutionContext {
  constructor({
    tenantId,
    sessionId,
    processId,
    processVersion,
    state,
    metadata,
  } = {}) {
    this.tenantId = tenantId || null;
    this.sessionId = sessionId || null;
    this.processId = processId || null;
    this.processVersion = typeof processVersion === 'number' ? processVersion : null;
    this.state = state && typeof state === 'object' ? state : {};
    this.metadata = metadata && typeof metadata === 'object' ? metadata : {};
  }

  withStatePatch(partialState = {}) {
    return new ProcessExecutionContext({
      tenantId: this.tenantId,
      sessionId: this.sessionId,
      processId: this.processId,
      processVersion: this.processVersion,
      state: {
        ...this.state,
        ...(partialState && typeof partialState === 'object' ? partialState : {}),
      },
      metadata: this.metadata,
    });
  }

  toJSON() {
    return {
      tenantId: this.tenantId,
      sessionId: this.sessionId,
      processId: this.processId,
      processVersion: this.processVersion,
      state: this.state,
      metadata: this.metadata,
    };
  }
}

module.exports = {
  ProcessExecutionContext,
};
