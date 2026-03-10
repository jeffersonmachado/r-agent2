'use strict';

const logger = require('../../utils/logger');
const { appendEventV1 } = require('../../services/eventLedgerService');

function safeStr(value) {
  const out = value == null ? '' : String(value).trim();
  return out || null;
}

const EVENT_TYPE_ALIASES = {
  support_ticket_created: 'ticket_created',
  support_ticket_assigned: 'ticket_status_changed',
  support_ticket_closed: 'ticket_status_changed',
  support_ticket_status_changed: 'ticket_status_changed',
  support_ticket_updated: 'ticket_updated',
  callback_scheduled: 'followup_due_candidate',
  callback_rescheduled: 'followup_due_candidate',
  campaign_contact_linked: 'lead_updated',
  campaign_created: 'lead_created',
  campaign_activated: 'lead_updated',
  operational_task_created: 'followup_due_candidate',
  schedule_conflict: 'schedule_conflict_detected',
  schedule_canceled: 'schedule_cancelled',
  whatsapp_inbound_message: 'whatsapp_message_received',
  whatsapp_outbound_message: 'whatsapp_message_sent',
  knowledge_gap: 'knowledge_gap_detected',
  knowledge_document_created: 'knowledge_document_suggested',
};

function normalizeEventType(type) {
  const raw = safeStr(type);
  if (!raw) return null;
  return EVENT_TYPE_ALIASES[raw] || raw;
}

async function writeOperationalEvent({
  tenantId,
  contactId,
  tenant_id = null,
  event_type = null,
  entity_type = null,
  entity_id = null,
  channel = null,
  metadata = null,
  event_id = null,
  created_at = null,
  accountId = null,
  type,
  sourceModule = 'crm',
  referenceType = null,
  referenceId = null,
  payload = {},
  actorType = null,
  actorId = null,
  correlationId = null,
  createdAt = null,
  dispatchToEventBus = true,
  triggerPipeline = true,
}) {
  const tenantKey = safeStr(tenantId) || safeStr(tenant_id);
  const contactKey = safeStr(contactId);
  const rawType = safeStr(type) || safeStr(event_type);
  const eventType = normalizeEventType(rawType);
  if (!tenantKey || !eventType) {
    return { ok: false, error: 'missing_required_fields' };
  }

  const referenceTypeKey = safeStr(referenceType) || safeStr(entity_type);
  const referenceIdKey = safeStr(referenceId) || safeStr(entity_id);
  const payloadBase = payload && typeof payload === 'object' ? payload : {};
  const metadataBase = metadata && typeof metadata === 'object' ? metadata : {};
  const payloadNormalized = {
    ...payloadBase,
    channel: safeStr(channel) || safeStr(payloadBase.channel),
    metadata: {
      ...(payloadBase.metadata && typeof payloadBase.metadata === 'object' ? payloadBase.metadata : {}),
      ...metadataBase,
      ...(rawType && rawType !== eventType ? { originalEventType: rawType } : {}),
      ...(event_id ? { eventId: safeStr(event_id) } : {}),
    },
  };

  const CRMEventService = require('./CRMEventService');
  const out = await CRMEventService.createOperationalEvent({
    tenantId: tenantKey,
    contactId: contactKey,
    accountId: safeStr(accountId),
    type: eventType,
    sourceModule,
    referenceType: referenceTypeKey,
    referenceId: referenceIdKey,
    payload: payloadNormalized,
    actorType,
    actorId,
    correlationId,
    createdAt: createdAt || created_at,
  });

  if (!out?.ok || !out?.event) return out;

  let ledgerResult = { ok: true, id: null, type: 'CrmOperationalEvent' };

  // Estratégia incremental escolhida (OPÇÃO A): ponte de escrita para event_ledger.
  // Mantém trilhas legadas sem reescrever histórico e garante rastreabilidade operacional.
  try {
    const event = out.event;
    const referenceTypeSafe = safeStr(event.reference_type) || safeStr(referenceType);
    const referenceIdSafe = safeStr(event.reference_id) || safeStr(referenceId);
    const subject = referenceTypeSafe && referenceIdSafe
      ? { type: referenceTypeSafe, id: referenceIdSafe }
      : (safeStr(event.contact_id)
        ? { type: 'crm_contact', id: safeStr(event.contact_id) }
        : (safeStr(event.account_id)
          ? { type: 'crm_account', id: safeStr(event.account_id) }
          : { type: 'crm_event', id: safeStr(event.id) || null }));

    const ledgerRow = await appendEventV1({
      tenantId: tenantKey,
      type: 'CrmOperationalEvent',
      source: 'crm.operational_writer',
      occurredAt: event.created_at || createdAt || new Date(),
      correlationId: safeStr(correlationId),
      subject,
      actor: {
        type: safeStr(event.actor_type) || safeStr(actorType) || 'system',
        id: safeStr(event.actor_id) || safeStr(actorId) || 'crm-operational-writer',
      },
      idempotencyKey: `crm_operational:${safeStr(event.id) || new Date().toISOString()}`,
      payload: {
        crmEventId: safeStr(event.id),
        operationalType: safeStr(event.type) || eventType,
        sourceModule: safeStr(event.source_module) || safeStr(sourceModule) || 'crm',
        contactId: safeStr(event.contact_id),
        accountId: safeStr(event.account_id),
        referenceType: referenceTypeSafe || referenceTypeKey,
        referenceId: referenceIdSafe || referenceIdKey,
        payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
      },
    });

    ledgerResult = {
      ok: true,
      id: ledgerRow?.id || null,
      type: ledgerRow?.type || 'CrmOperationalEvent',
    };
  } catch (err) {
    logger.debug('[OperationalEventWriter] Falha ao criar ponte para event_ledger (ignorado)', {
      error: err?.message || String(err || 'unknown_error'),
      type: eventType,
      tenantId: tenantKey,
    });
    ledgerResult = {
      ok: false,
      error: err?.message || 'event_ledger_bridge_failed',
    };
  }

  if (dispatchToEventBus) {
    try {
      const { operationalEventBus } = require('../operational-agent/OperationalEventBus');
      operationalEventBus.publishEventBestEffort({
        tenantId: tenantKey,
        contactId: safeStr(out.event.contact_id) || contactKey,
        type: eventType,
        sourceModule: safeStr(out.event.source_module) || sourceModule,
        payload: out.event.payload && typeof out.event.payload === 'object' ? out.event.payload : payloadNormalized,
        referenceType: safeStr(out.event.reference_type) || referenceTypeKey,
        referenceId: safeStr(out.event.reference_id) || referenceIdKey,
        actorType: safeStr(out.event.actor_type) || safeStr(actorType) || 'system',
        actorId: safeStr(out.event.actor_id) || safeStr(actorId) || 'crm-operational-writer',
        correlationId: safeStr(out.event.correlation_id) || safeStr(correlationId),
        created_at: out.event.created_at || createdAt || created_at,
        event_id: safeStr(out.event.id) || event_id,
        metadata: {
          bridgedBy: 'operational_event_writer',
          dispatchToEventBus: true,
        },
        triggerPipeline: triggerPipeline !== false,
        persistEvent: false,
        persistedEvent: out.event,
      }, 'OperationalEventWriter.dispatchToEventBus');
    } catch (err) {
      logger.debug('[OperationalEventWriter] Falha ao despachar evento para bus (ignorado)', {
        error: err?.message || String(err || 'unknown_error'),
        type: eventType,
        tenantId: tenantKey,
      });
    }
  }

  return {
    ...out,
    ledger: ledgerResult,
  };
}

function writeOperationalEventBestEffort(input, contextLabel = 'OperationalEventWriter') {
  Promise.resolve()
    .then(() => writeOperationalEvent(input))
    .catch((err) => {
      logger.debug(`[${contextLabel}] Falha ao registrar evento operacional CRM (ignorado)`, {
        error: err?.message || String(err || 'unknown_error'),
        type: input?.type || null,
        tenantId: input?.tenantId || null,
      });
    });
}

module.exports = {
  normalizeEventType,
  writeOperationalEvent,
  writeOperationalEventBestEffort,
};
