'use strict';

const { SignalDetectionService } = require('../core/operational-agent');

const service = new SignalDetectionService();

module.exports = {
  SignalDetectionService,
  detectTenantSignals: (params) => service.detectTenantSignals(params),
  detectContactSignals: (params) => service.detectContactSignals(params),
};
