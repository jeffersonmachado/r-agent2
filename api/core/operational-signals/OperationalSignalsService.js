'use strict';

const { SignalService } = require('../operational-agent/SignalService');
const { SignalQueryService } = require('../operational-agent/SignalQueryService');
const { createOperationalSignal } = require('../operational-contracts');

class OperationalSignalsService {
  constructor({ signalService, signalQueryService } = {}) {
    this.signalService = signalService || new SignalService();
    this.signalQueryService = signalQueryService || new SignalQueryService();
  }

  async generateForTenant({ tenantId } = {}) {
    return this.signalService.generateTenantSignals({ tenantId });
  }

  async generateForContact({ tenantId, contactId } = {}) {
    return this.signalService.generateContactSignals({ tenantId, contactId });
  }

  async listTenantSignals(params = {}) {
    const out = await this.signalQueryService.listTenantSignals(params);
    if (!out?.ok) return out;
    return { ...out, items: (out.items || []).map(createOperationalSignal) };
  }

  async listContactSignals(params = {}) {
    const out = await this.signalQueryService.listContactSignals(params);
    if (!out?.ok) return out;
    return { ...out, items: (out.items || []).map(createOperationalSignal) };
  }
}

module.exports = {
  OperationalSignalsService,
};
