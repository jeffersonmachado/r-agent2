'use strict';

const { OperationalEventsService } = require('./OperationalEventsService');

const operationalEventsService = new OperationalEventsService();

module.exports = {
  OperationalEventsService,
  operationalEventsService,
};
