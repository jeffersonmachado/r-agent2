'use strict';

const { writeOperationalEventBestEffort } = require('../crm/OperationalEventWriter');
const OperationalSignalRegistry = require('./OperationalSignalRegistry');

function mapSignalStatusEvent(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'acknowledged') return 'operational_signal_acknowledged';
  if (normalized === 'resolved') return 'operational_signal_resolved';
  if (normalized === 'expired') return 'operational_signal_expired';
  return 'operational_signal_opened';
}

class SignalQueryService {
  constructor({ signalRegistry } = {}) {
    this.signalRegistry = signalRegistry || OperationalSignalRegistry;
  }

  async listTenantSignals({ tenantId, activeOnly = false, limit = 200 } = {}) {
    return this.signalRegistry.listSignals({ tenantId, activeOnly, limit });
  }

  async listContactSignals({ tenantId, contactId, activeOnly = false, limit = 200 } = {}) {
    return this.signalRegistry.listSignals({ tenantId, contactId, activeOnly, limit });
  }

  async updateSignalStatus({ tenantId, signalId, status, actorId = null, contextLabel = 'SignalQueryService.updateSignalStatus' } = {}) {
    const out = await this.signalRegistry.updateSignalStatus({ tenantId, signalId, status });
    if (!out.ok) return out;

    writeOperationalEventBestEffort({
      tenantId,
      contactId: out.item?.contact_id || null,
      type: mapSignalStatusEvent(out.item?.status),
      sourceModule: 'operational_agent',
      referenceType: 'operational_signal',
      referenceId: out.item?.id || signalId,
      payload: {
        signalType: out.item?.type || null,
        status: out.item?.status || null,
        severity: out.item?.severity || null,
      },
      actorType: actorId ? 'user' : 'system',
      actorId: actorId ? String(actorId) : 'operational-agent',
      correlationId: out.item?.id || signalId,
    }, contextLabel);

    return out;
  }
}

module.exports = {
  SignalQueryService,
};
