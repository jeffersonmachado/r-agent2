'use strict';

const { OperationalMemoryService } = require('./OperationalMemoryService');

const operationalMemoryService = new OperationalMemoryService();

module.exports = {
  OperationalMemoryService,
  operationalMemoryService,
};
