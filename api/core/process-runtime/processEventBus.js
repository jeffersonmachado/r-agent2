'use strict';

const EventEmitter = require('events');

class ProcessEventBus extends EventEmitter {
  emitProcessEvent(eventType, payload = {}) {
    const event = {
      type: String(eventType || 'process.event'),
      timestamp: new Date().toISOString(),
      payload: payload && typeof payload === 'object' ? payload : {},
    };
    this.emit(event.type, event);
    this.emit('process.event', event);
    return event;
  }
}

module.exports = {
  ProcessEventBus,
};
