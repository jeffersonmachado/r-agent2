'use strict';

const { EventEmitter } = require('events');
const logger = require('../../utils/logger');
const { writeOperationalEvent } = require('../crm/OperationalEventWriter');
const { OperationalAgentService } = require('./OperationalAgentService');
const { setupOperationalOutcomeObserver } = require('../operational-outcomes');

function safeString(value) {
  const normalized = value == null ? '' : String(value).trim();
  return normalized || null;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

class OperationalEventBus {
  constructor({ operationalAgentService } = {}) {
    this.operationalAgentService = operationalAgentService || new OperationalAgentService();
    this.emitter = new EventEmitter();
  }

  on(eventName, handler) {
    this.emitter.on(String(eventName || ''), handler);
    return () => this.off(eventName, handler);
  }

  off(eventName, handler) {
    this.emitter.off(String(eventName || ''), handler);
  }

  async publishEvent({
    tenantId,
    contactId = null,
    type,
    tenant_id = null,
    event_type = null,
    entity_type = null,
    entity_id = null,
    channel = null,
    metadata = null,
    event_id = null,
    created_at = null,
    sourceModule = 'operational_event_bus',
    payload = {},
    referenceType = null,
    referenceId = null,
    actorType = 'system',
    actorId = 'operational-event-bus',
    correlationId = null,
    triggerPipeline = true,
    persistEvent = true,
    persistedEvent = null,
  } = {}) {
    const tenantKey = safeString(tenantId) || safeString(tenant_id);
    const eventType = safeString(type) || safeString(event_type);
    const contactKey = safeString(contactId)
      || safeString(payload?.contactId)
      || safeString(payload?.contact_id);
    const payloadSafe = payload && typeof payload === 'object' ? payload : {};
    const referenceTypeSafe = safeString(referenceType) || safeString(entity_type);
    const referenceIdSafe = safeString(referenceId) || safeString(entity_id);
    const metadataSafe = safeObject(metadata || payloadSafe.metadata);
    const eventIdSafe = safeString(event_id) || safeString(metadataSafe.eventId);

    if (!tenantKey) return { ok: false, error: 'tenant_required' };
    if (!eventType) return { ok: false, error: 'type_required' };

    let eventOut = persistedEvent ? { ok: true, event: persistedEvent } : null;
    if (persistEvent) {
      try {
        eventOut = await writeOperationalEvent({
          tenantId: tenantKey,
          contactId: contactKey,
          type: eventType,
          sourceModule,
          payload: {
            ...payloadSafe,
            channel: safeString(channel) || safeString(payloadSafe.channel),
            metadata: {
              ...(safeObject(payloadSafe.metadata)),
              ...metadataSafe,
              ...(eventIdSafe ? { eventId: eventIdSafe } : {}),
            },
          },
          referenceType: referenceTypeSafe,
          referenceId: referenceIdSafe,
          actorType,
          actorId,
          correlationId,
          event_id: eventIdSafe,
          created_at,
          dispatchToEventBus: false,
        });
      } catch (err) {
        logger.warn('[OperationalEventBus] Falha ao persistir evento operacional', {
          tenantId: tenantKey,
          type: eventType,
          error: err?.message || String(err || 'unknown_error'),
        });
        eventOut = { ok: false, error: err?.message || 'event_persistence_failed' };
      }
    }

    const eventEnvelope = {
      tenantId: tenantKey,
      contactId: contactKey,
      type: eventType,
      payload: payloadSafe,
      event_id: eventIdSafe,
      event_type: eventType,
      tenant_id: tenantKey,
      entity_type: referenceTypeSafe,
      entity_id: referenceIdSafe,
      channel: safeString(channel) || safeString(payloadSafe.channel),
      metadata: {
        ...metadataSafe,
        ...(eventIdSafe ? { eventId: eventIdSafe } : {}),
      },
      created_at: safeString(created_at) || new Date().toISOString(),
      sourceModule: safeString(sourceModule) || 'operational_event_bus',
      referenceType: referenceTypeSafe,
      referenceId: referenceIdSafe,
      actorType: safeString(actorType) || 'system',
      actorId: safeString(actorId) || 'operational-event-bus',
      correlationId: safeString(correlationId),
      persisted: eventOut?.ok === true,
      persistedEvent: eventOut?.event || null,
      persistedError: eventOut?.ok === true ? null : (eventOut?.error || null),
    };

    this.emitter.emit('operational:event', eventEnvelope);
    this.emitter.emit(`operational:event:${eventType}`, eventEnvelope);

    if (!triggerPipeline) {
      return {
        ok: true,
        event: eventEnvelope,
        pipeline: { triggered: false },
      };
    }

    if (typeof this.operationalAgentService.processOperationalEvent === 'function') {
      try {
        const eventDrivenOut = await this.operationalAgentService.processOperationalEvent({
          event: eventEnvelope,
        });

        if (eventDrivenOut?.ok && Array.isArray(eventDrivenOut.signals) && eventDrivenOut.signals.length > 0) {
          return {
            ok: true,
            event: eventEnvelope,
            pipeline: {
              triggered: true,
              mode: 'event_driven',
              ok: true,
              signals: eventDrivenOut.signals,
              recommendations: eventDrivenOut.recommendations || [],
            },
          };
        }
      } catch (err) {
        logger.warn('[OperationalEventBus] Falha no pipeline event-driven; fallback contextual', {
          tenantId: tenantKey,
          contactId: contactKey,
          type: eventType,
          error: err?.message || String(err || 'unknown_error'),
        });
      }
    }

    let signals = null;
    let recommendations = null;
    try {
      if (contactKey) {
        signals = await this.operationalAgentService.generateContactSignals({ tenantId: tenantKey, contactId: contactKey });
        recommendations = await this.operationalAgentService.generateContactRecommendations({
          tenantId: tenantKey,
          contactId: contactKey,
          includeSignalGeneration: false,
        });
      } else {
        signals = await this.operationalAgentService.generateTenantSignals({ tenantId: tenantKey });
        recommendations = await this.operationalAgentService.generateTenantRecommendations({
          tenantId: tenantKey,
          includeSignalGeneration: false,
        });
      }
    } catch (err) {
      logger.warn('[OperationalEventBus] Falha ao processar pipeline operacional', {
        tenantId: tenantKey,
        contactId: contactKey,
        type: eventType,
        error: err?.message || String(err || 'unknown_error'),
      });
      return {
        ok: true,
        event: eventEnvelope,
        pipeline: {
          triggered: true,
          ok: false,
          error: err?.message || 'pipeline_failed',
        },
      };
    }

    return {
      ok: true,
      event: eventEnvelope,
      pipeline: {
        triggered: true,
        ok: true,
        signals,
        recommendations,
      },
    };
  }

  publishEventBestEffort(input = {}, contextLabel = 'OperationalEventBus') {
    Promise.resolve()
      .then(() => this.publishEvent(input))
      .catch((err) => {
        logger.debug(`[${contextLabel}] Falha no publishEventBestEffort (ignorado)`, {
          error: err?.message || String(err || 'unknown_error'),
          type: input?.type || null,
          tenantId: input?.tenantId || null,
        });
      });
  }
}

const operationalEventBus = new OperationalEventBus();
setupOperationalOutcomeObserver({ eventBus: operationalEventBus });

module.exports = {
  OperationalEventBus,
  operationalEventBus,
};
