'use strict';

const { EventEmitter } = require('events');

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
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : fallbackValue;
}

function safeHasOwn(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch (_) {
    return false;
  }
}

function safeShallowCloneRecord(value) {
  if (!value || typeof value !== 'object') return {};
  try {
    return { ...value };
  } catch (_) {
    return {};
  }
}

function normalizeEventType(eventType, fallbackType = 'PROCESS_EVENT') {
  return safeToString(eventType, fallbackType) || fallbackType;
}

function sanitizePayloadRecord(payload) {
  if (payload && typeof payload === 'object') {
    return safeShallowCloneRecord(payload);
  }
  return { payload: safeClone(payload) };
}

function normalizeBusEvent(event, defaultMode = 'broadcast') {
  const safeEvent = safeShallowCloneRecord(event);
  return {
    ...safeEvent,
    eventType: normalizeEventType(safeGet(safeEvent, 'eventType', 'PROCESS_EVENT')),
    timestamp: safeGet(safeEvent, 'timestamp', null) || new Date().toISOString(),
    mode: safeToString(safeGet(safeEvent, 'mode', defaultMode), defaultMode) || defaultMode,
    payload: safeClone(safeGet(safeEvent, 'payload', undefined), safeGet(safeEvent, 'payload', undefined)),
    metadata: safeClone(safeGet(safeEvent, 'metadata', undefined), safeGet(safeEvent, 'metadata', undefined)),
  };
}

class ProcessEventBus {
  constructor({ executionRepository } = {}) {
    this._emitter = new EventEmitter();
    this._events = [];
    this._executionRepository = executionRepository || null;
  }

  on(eventType, listener) {
    this._emitter.on(eventType, listener);
    return () => this.off(eventType, listener);
  }

  off(eventType, listener) {
    this._emitter.off(eventType, listener);
  }

  async persistExecutionEvent(eventType, payload = {}) {
    const event = normalizeBusEvent({
      ...sanitizePayloadRecord(payload),
      eventType: normalizeEventType(eventType),
      timestamp: new Date().toISOString(),
      mode: 'persisted',
    }, 'persisted');
    const executionId = safeToString(safeGet(event, 'executionId', ''), '');
    if (this._executionRepository && executionId) {
      const requestedSequence = safeFiniteNumber(safeGet(event, 'sequence', 0), 0);
      const sequence = requestedSequence > 0
        ? requestedSequence
        : await this._executionRepository.getNextSequence(executionId);
      const persisted = await this._executionRepository.appendEvent({
        ...event,
        executionId,
        sequence,
      });
      const normalizedPersisted = normalizeBusEvent(persisted, 'persisted');
      this._events.push(normalizedPersisted);
      return normalizedPersisted;
    }
    this._events.push(event);
    return event;
  }

  publishRuntimeEvent(event) {
    const runtimeEvent = normalizeBusEvent(event, 'broadcast');
    this._emitter.emit(runtimeEvent.eventType, runtimeEvent);
    this._emitter.emit('*', runtimeEvent);
    return runtimeEvent;
  }

  async emit(eventType, payload = {}) {
    const event = await this.persistExecutionEvent(eventType, payload);
    return this.publishRuntimeEvent(event);
  }

  getEvents(filter = {}) {
    const hasExecutionId = safeHasOwn(filter || {}, 'executionId');
    const executionId = hasExecutionId ? safeToString(safeGet(filter, 'executionId', ''), '') : null;
    if (!executionId) return this._events.slice();
    return this._events.filter((event) => safeToString(safeGet(event, 'executionId', ''), '') === executionId);
  }
}

module.exports = {
  ProcessEventBus,
};
