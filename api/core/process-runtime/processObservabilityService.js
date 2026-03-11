'use strict';

const { buildExecutionTelemetry } = require('./processExecutionTelemetry');

class ProcessObservabilityService {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus || null;
    this.counters = {
      nodeEnter: 0,
      nodeExit: 0,
      failedSteps: 0,
      fallbackTriggered: 0,
      handoffTriggered: 0,
      timeoutTriggered: 0,
    };
  }

  recordStep(eventPayload = {}) {
    const telemetry = buildExecutionTelemetry(eventPayload);

    this.counters.nodeEnter += 1;
    this.counters.nodeExit += 1;
    if (telemetry.status === 'error') this.counters.failedSteps += 1;
    if (telemetry.fallbackTriggered) this.counters.fallbackTriggered += 1;
    if (telemetry.handoffTriggered) this.counters.handoffTriggered += 1;
    if (telemetry.timeoutTriggered) this.counters.timeoutTriggered += 1;

    if (this.eventBus && typeof this.eventBus.emitProcessEvent === 'function') {
      this.eventBus.emitProcessEvent('process.telemetry.step', telemetry);
    }

    return telemetry;
  }

  snapshot() {
    return {
      ...this.counters,
      generatedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  ProcessObservabilityService,
};
