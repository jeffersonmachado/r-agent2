'use strict';

const { EventEmitter } = require('events');

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
    const event = {
      eventType: String(eventType || 'PROCESS_EVENT'),
      timestamp: new Date().toISOString(),
      mode: 'persisted',
      ...(payload && typeof payload === 'object' ? payload : { payload }),
    };
    if (this._executionRepository && event.executionId) {
      const sequence = event.sequence || await this._executionRepository.getNextSequence(event.executionId);
      const persisted = await this._executionRepository.appendEvent({
        ...event,
        sequence,
      });
      this._events.push(persisted);
      return persisted;
    }
    this._events.push(event);
    return event;
  }

  publishRuntimeEvent(event) {
    const runtimeEvent = {
      ...event,
      mode: event.mode || 'broadcast',
    };
    this._emitter.emit(runtimeEvent.eventType, runtimeEvent);
    this._emitter.emit('*', runtimeEvent);
    return runtimeEvent;
  }

  async emit(eventType, payload = {}) {
    const event = await this.persistExecutionEvent(eventType, payload);
    return this.publishRuntimeEvent(event);
  }

  getEvents(filter = {}) {
    const executionId = filter.executionId ? String(filter.executionId) : null;
    if (!executionId) return this._events.slice();
    return this._events.filter((event) => String(event.executionId || '') === executionId);
  }
}

module.exports = {
  ProcessEventBus,
};
