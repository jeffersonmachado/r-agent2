'use strict';

const { writeOperationalEventBestEffort } = require('../crm/OperationalEventWriter');
const { SignalDetectionService } = require('./SignalDetectionService');
const OperationalSignalRegistry = require('./OperationalSignalRegistry');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

class SignalService {
  constructor({ detectionService, signalRegistry } = {}) {
    this.detectionService = detectionService || new SignalDetectionService();
    this.signalRegistry = signalRegistry || OperationalSignalRegistry;
  }

  async generateTenantSignals({ tenantId, contextLabel = 'SignalService.generateTenantSignals' } = {}) {
    const tenantKey = safeString(tenantId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const detected = await this.detectionService.detectTenantSignals({ tenantId: tenantKey });
    if (!detected.ok) return detected;

    const upserted = await this.signalRegistry.upsertDetectedSignals({
      tenantId: tenantKey,
      signals: detected.signals || [],
      dedupWindowMinutes: 240,
    });
    if (!upserted.ok) return upserted;

    for (const item of upserted.opened || []) {
      writeOperationalEventBestEffort({
        tenantId: tenantKey,
        contactId: item.contact_id || null,
        type: 'operational_signal_opened',
        sourceModule: 'operational_agent',
        referenceType: 'operational_signal',
        referenceId: item.id,
        payload: {
          signalType: item.type,
          severity: item.severity,
          confidence: item.confidence,
        },
        actorType: 'system',
        actorId: 'operational-agent',
        correlationId: item.id,
      }, contextLabel);
    }

    return {
      ok: true,
      tenantId: tenantKey,
      opened: upserted.opened || [],
      merged: upserted.merged || [],
      items: upserted.items || [],
      detectionContext: detected.context || null,
    };
  }

  async generateContactSignals({ tenantId, contactId, contextLabel = 'SignalService.generateContactSignals' } = {}) {
    const tenantKey = safeString(tenantId);
    const contactKey = safeString(contactId);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!contactKey) return { ok: false, error: 'contact_required' };

    const detected = await this.detectionService.detectContactSignals({ tenantId: tenantKey, contactId: contactKey });
    if (!detected.ok) return detected;

    const upserted = await this.signalRegistry.upsertDetectedSignals({
      tenantId: tenantKey,
      signals: detected.signals || [],
      dedupWindowMinutes: 240,
    });
    if (!upserted.ok) return upserted;

    for (const item of upserted.opened || []) {
      writeOperationalEventBestEffort({
        tenantId: tenantKey,
        contactId: item.contact_id || null,
        type: 'operational_signal_opened',
        sourceModule: 'operational_agent',
        referenceType: 'operational_signal',
        referenceId: item.id,
        payload: {
          signalType: item.type,
          severity: item.severity,
          confidence: item.confidence,
        },
        actorType: 'system',
        actorId: 'operational-agent',
        correlationId: item.id,
      }, contextLabel);
    }

    return {
      ok: true,
      tenantId: tenantKey,
      contactId: contactKey,
      opened: upserted.opened || [],
      merged: upserted.merged || [],
      items: (upserted.items || []).filter((item) => String(item.contact_id || '') === contactKey),
      detectionContext: detected.context || null,
    };
  }
}

module.exports = {
  SignalService,
};
