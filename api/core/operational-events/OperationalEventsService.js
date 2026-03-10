'use strict';

const { OperationalEventProcessor } = require('../operational-agent/OperationalEventProcessor');
const { createOperationalEvent } = require('../operational-contracts');

class OperationalEventsService {
  constructor({ eventProcessor } = {}) {
    this.eventProcessor = eventProcessor || new OperationalEventProcessor();
  }

  async ingestEvent(input = {}) {
    const event = createOperationalEvent(input);
    return this.eventProcessor.processOperationalEvent({ event });
  }
}

module.exports = {
  OperationalEventsService,
};
