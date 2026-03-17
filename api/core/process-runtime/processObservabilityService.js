'use strict';

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

function safeHasOwn(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch (_) {
    return false;
  }
}

function safeNow() {
  try {
    return Date.now();
  } catch (_) {
    return 0;
  }
}

function safeIsoNow() {
  try {
    return new Date().toISOString();
  } catch (_) {
    return '1970-01-01T00:00:00.000Z';
  }
}

function buildNodeTimingKey(event) {
  return `${safeToString(safeGet(event, 'executionId', ''), '')}:${safeToString(safeGet(event, 'nodeId', ''), '')}`;
}

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
    const key = buildNodeTimingKey(event);
    const eventType = safeToString(safeGet(event, 'eventType', 'PROCESS_EVENT'), 'PROCESS_EVENT') || 'PROCESS_EVENT';
    if (eventType === 'NODE_ENTER') {
      this._nodeEnterTimes.set(key, safeNow());
    }

    const metadata = safeClone(safeGet(event, 'metadata', {}), {}) ?? {};
    if (eventType === 'NODE_EXIT') {
      const startedAt = this._nodeEnterTimes.get(key);
      if (startedAt != null) {
        metadata.durationMs = Math.max(safeNow() - startedAt, 0);
        this._nodeEnterTimes.delete(key);
      }
    }

    const payload = safeClone(safeGet(event, 'payload', {}), {}) ?? {};
    const fallback = safeGet(payload, 'fallback', null) || safeGet(payload, 'mode', null) || null;
    const error = safeGet(payload, 'error', null);

    const record = {
      processId: safeGet(event, 'processId', null),
      executionId: safeGet(event, 'executionId', null),
      nodeId: safeGet(event, 'nodeId', null),
      nodeType: safeGet(event, 'nodeType', null),
      eventType,
      timestamp: safeGet(event, 'timestamp', null) || safeIsoNow(),
      durationMs: safeGet(metadata, 'durationMs', null),
      fallback,
      error,
      metadata,
    };
    this._records.push(record);
    return record;
  }

  getRecords(filter = {}) {
    const hasExecutionId = safeHasOwn(filter || {}, 'executionId');
    const executionId = hasExecutionId ? safeToString(safeGet(filter, 'executionId', ''), '') : null;
    if (!executionId) return this._records.slice();
    return this._records.filter((record) => safeToString(safeGet(record, 'executionId', ''), '') === executionId);
  }
}

module.exports = {
  ProcessObservabilityService,
};
