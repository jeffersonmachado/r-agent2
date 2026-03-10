'use strict';

const { writeOperationalEventBestEffort } = require('../crm/OperationalEventWriter');
const { SignalDetectionService } = require('./SignalDetectionService');
const OperationalSignalRegistry = require('./OperationalSignalRegistry');
const { RecommendationService } = require('./RecommendationService');

function safeString(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

class OperationalEventProcessor {
  constructor({ detectionService, signalRegistry, recommendationService } = {}) {
    this.detectionService = detectionService || new SignalDetectionService();
    this.signalRegistry = signalRegistry || OperationalSignalRegistry;
    this.recommendationService = recommendationService || new RecommendationService();
  }

  async processOperationalEvent({ event, dedupWindowMinutes = 240 } = {}) {
    const detected = await this.detectionService.detectSignalsFromEvent({ event });
    if (!detected.ok) return detected;

    const tenantKey = safeString(detected.tenantId || event?.tenantId || event?.tenant_id);
    if (!tenantKey) return { ok: false, error: 'tenant_required' };

    const upserted = await this.signalRegistry.upsertDetectedSignals({
      tenantId: tenantKey,
      signals: detected.signals || [],
      dedupWindowMinutes,
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
          sourceEventType: safeString(event?.eventType || event?.event_type || event?.type),
        },
        actorType: 'system',
        actorId: 'operational-agent',
        correlationId: item.id,
      }, 'OperationalEventProcessor.processOperationalEvent');
    }

    const touchedSignals = [...(upserted.opened || []), ...(upserted.merged || [])];
    const recommendationsOut = touchedSignals.length > 0
      ? await this.recommendationService.generateRecommendationsForSignals({ tenantId: tenantKey, signals: touchedSignals })
      : { ok: true, generated: [], items: [], total: 0 };

    return {
      ok: true,
      eventDriven: true,
      tenantId: tenantKey,
      contactId: safeString(detected.contactId),
      event: detected.event || event || null,
      opened: upserted.opened || [],
      merged: upserted.merged || [],
      signals: touchedSignals,
      recommendations: recommendationsOut?.generated || [],
      recommendationsTotal: Number(recommendationsOut?.total || 0),
    };
  }
}

module.exports = {
  OperationalEventProcessor,
};
