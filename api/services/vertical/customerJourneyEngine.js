'use strict';

/**
 * Customer Journey Engine (shared: beauty + fitness)
 *
 * Orchestrates the lifecycle of a customer journey step:
 *   pre_service → confirmation → reminder_24h → reminder_1h →
 *   no_show → post_service → follow_up → reactivation
 *
 * Principles:
 * - Multi-tenant: every call requires tenantId.
 * - Idempotent: idempotencyKey prevents duplicate events.
 * - Channel-agnostic: channel param chosen by caller (whatsapp/email/internal).
 * - Extensible per vertical via `payload` JSONB.
 * - Writes to event_ledger AND vertical_journey_events for operability.
 */

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const { VerticalJourneyEvent } = require('../../db/models');
const { appendEventV1 } = require('../eventLedgerService');

// ── constants ───────────────────────────────────────────────────────────────
const JOURNEY_EVENT_TYPES = [
  'pre_service',
  'confirmation_sent',
  'confirmation_received',
  'reminder_24h',
  'reminder_1h',
  'no_show_detected',
  'service_completed',
  'follow_up_sent',
  'reactivation_sent',
  'rescheduling_offered',
  'review_requested',
  'loyalty_points_granted',
  'loyalty_points_reversed',
  'welcome_sent',
  'frequency_alert_sent',
  'churn_risk_detected',
  'return_campaign_sent',
  'checkin_recorded',
  'checkout_recorded',
  'order_placed',
  'order_delivered',
  'quote_sent',
  'quote_approved',
  'quote_declined',
  'quote_expired',
  'quote_follow_up_sent',
  'charge_issued',
];

// ── helpers ──────────────────────────────────────────────────────────────────
function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function dbAvailable() {
  return !!getSequelize();
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return fallback; }
}

/**
 * Emit a journey event. Writes to:
 * 1. vertical_journey_events (operational / queryable)
 * 2. event_ledger (canonical audit trail)
 *
 * @param {object} params
 * @param {string}  params.tenantId
 * @param {string}  params.vertical          'beauty' | 'fitness'
 * @param {string}  params.eventType         one of JOURNEY_EVENT_TYPES
 * @param {string}  [params.subjectId]       AccessSubject.id
 * @param {string}  [params.customerId]      external customer ref
 * @param {string}  [params.membershipId]    AccessMembership.id
 * @param {string}  [params.scheduleId]      schedule ref
 * @param {string}  [params.channel]         'whatsapp'|'email'|'internal'|null
 * @param {string}  [params.triggeredBy]     'scheduler'|'manual'|'event'
 * @param {string}  [params.correlationId]
 * @param {string}  [params.idempotencyKey]  stable key to prevent duplicates
 * @param {object}  [params.payload]         event-specific details
 * @param {object}  [params.metadata]
 * @returns {Promise<object>}  the created (or existing) journey event row
 */
async function emitJourneyEvent({
  tenantId,
  vertical,
  eventType,
  subjectId = null,
  customerId = null,
  membershipId = null,
  scheduleId = null,
  channel = null,
  triggeredBy = 'manual',
  correlationId = null,
  idempotencyKey = null,
  payload = {},
  metadata = {},
}) {
  if (!tenantId) throw Object.assign(new Error('tenantId required'), { code: 'missing_tenant' });
  if (!vertical) throw Object.assign(new Error('vertical required'), { code: 'missing_vertical' });
  if (!eventType) throw Object.assign(new Error('eventType required'), { code: 'missing_event_type' });
  if (!JOURNEY_EVENT_TYPES.includes(eventType)) {
    throw Object.assign(new Error(`invalid eventType: ${eventType}`), { code: 'invalid_event_type' });
  }

  const resolvedKey = idempotencyKey || null;
  const id = resolvedKey
    ? `vje-${crypto.createHash('sha1').update(`${tenantId}:${eventType}:${resolvedKey}`).digest('hex').slice(0, 16)}`
    : makeId('vje');

  const now = new Date();
  const hasDb = dbAvailable();

  // ── 1. Write to vertical_journey_events ────────────────────────────────
  let row = null;
  if (hasDb) {
    // Idempotency: check for existing event before creating
    if (resolvedKey) {
      const Model = VerticalJourneyEvent();
      const existing = await Model.findOne({
        where: { tenant_key: tenantId, idempotency_key: resolvedKey },
      }).catch(() => null);
      if (existing) {
        return existing.toJSON ? existing.toJSON() : existing;
      }
    }
    try {
      const Model = VerticalJourneyEvent();
      row = await Model.create({
        id,
        tenant_key: tenantId,
        vertical,
        subject_id: subjectId,
        customer_id: customerId,
        membership_id: membershipId,
        schedule_id: scheduleId,
        event_type: eventType,
        status: 'emitted',
        channel,
        triggered_by: triggeredBy,
        correlation_id: correlationId,
        idempotency_key: resolvedKey,
        payload,
        metadata,
        occurred_at: now,
      });
      row = row && row.toJSON ? row.toJSON() : row;
    } catch (err) {
      const isUnique = String(err?.name || '').toLowerCase().includes('unique')
        || String(err?.message || '').toLowerCase().includes('unique')
        || String(err?.original?.code || '') === '23505';
      if (resolvedKey && isUnique) {
        const Model = VerticalJourneyEvent();
        const existing = await Model.findOne({
          where: { tenant_key: tenantId, idempotency_key: resolvedKey },
        }).catch(() => null);
        row = existing && existing.toJSON ? existing.toJSON() : existing;
        // idempotent – return existing without error
        return row || { id, tenant_key: tenantId, event_type: eventType, deduplicated: true };
      }
      throw err;
    }
  } else {
    // in-memory fallback (tests / no-DB mode)
    row = { id, tenant_key: tenantId, vertical, event_type: eventType, status: 'emitted', channel, occurred_at: now.toISOString(), payload, metadata };
  }

  // ── 2. Append to event_ledger (best-effort) ────────────────────────────
  if (hasDb) {
  await appendEventV1({
    tenantId,
    type: `VerticalJourney_${eventType}`,
    source: `vertical.journey.${vertical}`,
    occurredAt: now,
    correlationId: correlationId || id,
    subject: { type: vertical === 'beauty' ? 'beauty_customer' : `${vertical}_subject`, id: subjectId || customerId || 'unknown' },
    actor: { type: 'system', id: triggeredBy || 'journey_engine' },
    idempotencyKey: resolvedKey ? `journey_ledger:${resolvedKey}` : null,
    payload: { eventType, vertical, scheduleId, membershipId, ...payload },
  }).catch(() => {}); // never block the caller on audit failure
  }

  return row;
}

/**
 * List journey events for a subject / customer with optional filters.
 *
 * @param {object} params
 * @param {string}  params.tenantId
 * @param {string}  [params.vertical]
 * @param {string}  [params.subjectId]
 * @param {string}  [params.customerId]
 * @param {string}  [params.eventType]
 * @param {number}  [params.limit=50]
 * @returns {Promise<{items: object[], total: number}>}
 */
async function listJourneyEvents({ tenantId, vertical, subjectId, customerId, eventType, limit = 50 } = {}) {
  if (!dbAvailable()) return { items: [], total: 0 };
  const { Op } = require('sequelize');
  const Model = VerticalJourneyEvent();
  const where = { tenant_key: tenantId };
  if (vertical) where.vertical = vertical;
  if (subjectId) where.subject_id = subjectId;
  if (customerId) where.customer_id = customerId;
  if (eventType) where.event_type = eventType;

  const cap = Math.min(Number(limit) || 50, 500);
  const rows = await Model.findAll({
    where,
    order: [['occurred_at', 'DESC']],
    limit: cap,
  }).catch(() => []);

  return {
    items: rows.map((r) => (r.toJSON ? r.toJSON() : r)),
    total: rows.length,
  };
}

/**
 * Get operational timeline for a subject (all verticals, all event types).
 */
async function getSubjectTimeline({ tenantId, subjectId, customerId, limit = 100 }) {
  return listJourneyEvents({ tenantId, subjectId, customerId, limit });
}

module.exports = {
  JOURNEY_EVENT_TYPES,
  emitJourneyEvent,
  listJourneyEvents,
  getSubjectTimeline,
};
