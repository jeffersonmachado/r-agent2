'use strict';

const { OperationalContextService } = require('./OperationalContextService');

const operationalContextService = new OperationalContextService();

module.exports = {
  OperationalContextService,
  operationalContextService,
};
