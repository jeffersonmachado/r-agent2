/**
 * Event Model v1 (canonical events)
 *
 * This module defines a minimal contract to standardize events across modules
 * (physical queues, orders/delivery, PBX/CDR, etc.).
 */

const crypto = require('crypto');

const EVENT_TYPES_V1 = new Set([
  // Physical (Fast service)
  'PhysicalTicketCreated',
  'PhysicalTicketCalled',
  'PhysicalTicketFinished',
  'PhysicalServiceStarted',
  'PhysicalServicePaused',
  'PhysicalServiceResumed',
  'PhysicalTicketSkipped',
  'PhysicalTicketTransferred',
  'PhysicalTicketAbandoned',
  'PhysicalSLARisk',

  // Orders/Delivery
  'OrderCreated',
  'OrderStatusChanged',
  'DeliveryCreated',
  'DeliveryStatusChanged',
  'DeliverySLARisk',
  'SupportIncidentOpened',
  'SupportTicketOpened',

  // Scheduler / Ops
  'ScheduledTriggerFired',

  // PBX
  'PbxCdrIngested',
  'CallRinging',
  'CallAnswered',
  'CallEnded',

  // Voice runtime / gateway
  'VoiceCallRinging',
  'VoiceCallAnswered',
  'VoiceCallEnded',
  'VoiceCallDtmf',
  'VoiceCallTransfer',
  'VoiceFlowInput',
  'VoiceFlowAction',
  'VoiceRecordingCaptured',

  // CRM operacional integrado
  'CrmAccountUpserted',
  'CrmContactUpserted',
  'CrmLeadUpserted',
  'CrmPipelineUpserted',
  'CrmOpportunityUpserted',
  'CrmOpportunityStageChanged',
  'CrmActivityLogged',
]);

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeString(v, maxLen = 120) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * @typedef {object} CanonicalEventV1
 * @property {string} id
 * @property {string} tenant_key
 * @property {string} type
 * @property {string} source
 * @property {string} occurred_at ISO string
 * @property {string|null} correlation_id
 * @property {{type:string|null,id:string|null}} subject
 * @property {{type:string|null,id:string|null}} actor
 * @property {string|null} idempotency_key
 * @property {object} payload
 */

/**
 * Build a canonical event. Validation is shallow; storage layer enforces minimal constraints.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.type
 * @param {string} [args.source]
 * @param {Date|string} [args.occurredAt]
 * @param {string|null} [args.correlationId]
 * @param {{type?:string,id?:string}|null} [args.subject]
 * @param {{type?:string,id?:string}|null} [args.actor]
 * @param {string|null} [args.idempotencyKey]
 * @param {object} [args.payload]
 * @returns {CanonicalEventV1}
 */
function buildEventV1({
  tenantId,
  type,
  source = 'api',
  occurredAt = new Date(),
  correlationId = null,
  subject = null,
  actor = null,
  idempotencyKey = null,
  payload = {},
}) {
  const t = String(type || '').trim();
  if (!EVENT_TYPES_V1.has(t)) {
    const err = new Error(`unsupported_event_type:${t}`);
    // @ts-ignore
    err.code = 'unsupported_event_type';
    // @ts-ignore
    err.details = { type: t };
    throw err;
  }
  const dt = occurredAt instanceof Date ? occurredAt : new Date(occurredAt);
  const occurredIso = Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();

  return {
    id: makeId('evt'),
    tenant_key: String(tenantId),
    type: t,
    source: String(source || 'api'),
    occurred_at: occurredIso,
    correlation_id: normalizeString(correlationId, 120),
    subject: {
      type: normalizeString(subject && subject.type, 40),
      id: normalizeString(subject && subject.id, 128),
    },
    actor: {
      type: normalizeString(actor && actor.type, 40),
      id: normalizeString(actor && actor.id, 128),
    },
    idempotency_key: normalizeString(idempotencyKey, 160),
    payload: payload && typeof payload === 'object' ? payload : {},
  };
}

module.exports = {
  EVENT_TYPES_V1,
  buildEventV1,
};
