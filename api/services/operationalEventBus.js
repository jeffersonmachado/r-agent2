'use strict';

const { OperationalEventBus, operationalEventBus } = require('../core/operational-agent');

module.exports = {
  OperationalEventBus,
  operationalEventBus,
  publishEvent: (params) => operationalEventBus.publishEvent(params),
  publishEventBestEffort: (params, contextLabel) => operationalEventBus.publishEventBestEffort(params, contextLabel),
};
