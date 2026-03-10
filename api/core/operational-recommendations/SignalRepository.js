'use strict';

const OperationalSignalRegistry = require('../operational-agent/OperationalSignalRegistry');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

class SignalRepository {
  constructor({ signalRegistry } = {}) {
    this.signalRegistry = signalRegistry || OperationalSignalRegistry;
  }

  async listTenantActiveSignals({ tenantId, limit = 500 } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    return this.signalRegistry.listSignals({
      tenantId: tenantKey,
      activeOnly: true,
      limit,
    });
  }

  async listContactActiveSignals({ tenantId, contactId, limit = 500 } = {}) {
    const tenantKey = safeString(tenantId);
    const contactKey = safeString(contactId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!contactKey) return { ok: false, error: 'contact_required' };
    return this.signalRegistry.listSignals({
      tenantId: tenantKey,
      contactId: contactKey,
      activeOnly: true,
      limit,
    });
  }
}

module.exports = {
  SignalRepository,
};
