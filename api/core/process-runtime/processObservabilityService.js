'use strict';

class ProcessObservabilityService {
  constructor({ eventBus } = {}) {
    this._records = [];
    this._nodeEnterTimes = new Map();
    if (eventBus && typeof eventBus.on === 'function') {
      eventBus.on('*', (event) => this.record(event));
    }
  }

  record(event) {
    if (!event || typeof event !== 'object') return null;
    const key = `${event.executionId || ''}:${event.nodeId || ''}`;
    if (event.eventType === 'NODE_ENTER') {
      this._nodeEnterTimes.set(key, Date.now());
    }

    const metadata = { ...(event.metadata || {}) };
    if (event.eventType === 'NODE_EXIT') {
      const startedAt = this._nodeEnterTimes.get(key);
      if (startedAt) {
        metadata.durationMs = Date.now() - startedAt;
        this._nodeEnterTimes.delete(key);
      }
    }

    const record = {
      processId: event.processId || null,
      executionId: event.executionId || null,
      nodeId: event.nodeId || null,
      nodeType: event.nodeType || null,
      eventType: event.eventType || 'PROCESS_EVENT',
      timestamp: event.timestamp || new Date().toISOString(),
      durationMs: metadata.durationMs || null,
      fallback: event.payload?.fallback || event.payload?.mode || null,
      error: event.payload?.error || null,
      metadata,
    };
    this._records.push(record);
    return record;
  }

  getRecords(filter = {}) {
    const executionId = filter.executionId ? String(filter.executionId) : null;
    if (!executionId) return this._records.slice();
    return this._records.filter((record) => String(record.executionId || '') === executionId);
  }
}

module.exports = {
  ProcessObservabilityService,
};
