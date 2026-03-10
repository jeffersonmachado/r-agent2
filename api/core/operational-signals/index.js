'use strict';

const { OperationalSignalsService } = require('./OperationalSignalsService');

const operationalSignalsService = new OperationalSignalsService();

module.exports = {
  OperationalSignalsService,
  operationalSignalsService,
};
