'use strict';

/**
 * Beauty Journey Service
 *
 * Orchestrates the complete Beauty vertical journey:
 * - Appointment confirmation (sent / received)
 * - 24h and near-time reminders
 * - No-show detection and re-offer
 * - Post-service follow-up and review request
 * - Loyalty point grant on completed service
 * - Reactivation for inactive customers
 *
 * Uses customerJourneyEngine for event storage and billingOrchestrationService
 * for package/session management.
 */

const { emitJourneyEvent } = require('./customerJourneyEngine');
const { consumeSession, getSessionBalance } = require('./billingOrchestrationService');
const { appendEventV1 } = require('../eventLedgerService');

const VERTICAL = 'beauty';

// ── Confirmation ─────────────────────────────────────────────────────────

/**
 * Send appointment confirmation to customer.
 */
async function sendConfirmation({ tenantId, subjectId, customerId, scheduleId, channel = 'internal', correlationId, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'confirmation_sent',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: metadata.triggeredBy || 'manual',
    correlationId,
    idempotencyKey: scheduleId ? `beauty_confirmation:${tenantId}:${scheduleId}` : null,
    payload: { message: 'Appointment confirmation sent', ...metadata },
  });
}

/**
 * Record that confirmation was received / acknowledged.
 */
async function recordConfirmationReceived({ tenantId, subjectId, customerId, scheduleId, correlationId, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'confirmation_received',
    subjectId,
    customerId,
    scheduleId,
    channel: metadata.channel || 'internal',
    triggeredBy: 'event',
    correlationId,
    idempotencyKey: scheduleId ? `beauty_conf_recv:${tenantId}:${scheduleId}` : null,
    payload: metadata,
  });
}

// ── Reminders ────────────────────────────────────────────────────────────

async function sendReminder24h({ tenantId, subjectId, customerId, scheduleId, channel = 'internal', correlationId, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'reminder_24h',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: 'scheduler',
    correlationId,
    idempotencyKey: scheduleId ? `beauty_reminder24h:${tenantId}:${scheduleId}` : null,
    payload: { message: '24h reminder sent', ...metadata },
  });
}

async function sendReminderNearTime({ tenantId, subjectId, customerId, scheduleId, channel = 'internal', correlationId, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'reminder_1h',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: 'scheduler',
    correlationId,
    idempotencyKey: scheduleId ? `beauty_reminder1h:${tenantId}:${scheduleId}` : null,
    payload: { message: 'Near-time reminder sent', ...metadata },
  });
}

// ── No-show ───────────────────────────────────────────────────────────────

/**
 * Detect and record a no-show. Automatically offers rescheduling.
 */
async function detectNoShow({ tenantId, subjectId, customerId, scheduleId, correlationId, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'no_show_detected',
    subjectId,
    customerId,
    scheduleId,
    channel: 'internal',
    triggeredBy: metadata.triggeredBy || 'scheduler',
    correlationId,
    idempotencyKey: scheduleId ? `beauty_noshow:${tenantId}:${scheduleId}` : null,
    payload: metadata,
  });

  // Auto-offer rescheduling (separate event, idempotent)
  await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'rescheduling_offered',
    subjectId,
    customerId,
    scheduleId,
    channel: metadata.channel || 'internal',
    triggeredBy: 'event',
    correlationId,
    idempotencyKey: scheduleId ? `beauty_reoferta:${tenantId}:${scheduleId}` : null,
    payload: { trigger: 'no_show', ...metadata },
  }).catch(() => {});

  return evt;
}

// ── Post-service ──────────────────────────────────────────────────────────

/**
 * Record service completion:
 * - emits service_completed event
 * - deducts session from bundle if applicable
 * - grants loyalty points
 */
async function recordServiceCompleted({ tenantId, subjectId, customerId, scheduleId, bundleId, correlationId, loyaltyPoints = 1, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'service_completed',
    subjectId,
    customerId,
    scheduleId,
    channel: 'internal',
    triggeredBy: 'event',
    correlationId,
    idempotencyKey: scheduleId ? `beauty_completed:${tenantId}:${scheduleId}` : null,
    payload: { loyaltyPoints, ...metadata },
  });

  // Session consumption from bundle (best-effort)
  if (bundleId) {
    await consumeSession({ tenantId, bundleId, correlationId: scheduleId || correlationId }).catch(() => {});
  }

  // Grant loyalty points (ledger event)
  await appendEventV1({
    tenantId,
    type: 'LoyaltyPointsGranted',
    source: `vertical.journey.${VERTICAL}`,
    occurredAt: new Date(),
    correlationId: scheduleId || correlationId,
    subject: { type: 'beauty_customer', id: subjectId || customerId || 'unknown' },
    actor: { type: 'system', id: 'beauty_journey' },
    idempotencyKey: scheduleId ? `loyalty_grant:${tenantId}:${scheduleId}` : null,
    payload: { points: loyaltyPoints, reason: 'service_completed', subjectId, customerId, scheduleId },
  }).catch(() => {});

  // Send follow-up after service (chained, idempotent)
  await sendFollowUp({ tenantId, subjectId, customerId, scheduleId, correlationId, metadata }).catch(() => {});

  return evt;
}

// ── Follow-up and review ─────────────────────────────────────────────────

async function sendFollowUp({ tenantId, subjectId, customerId, scheduleId, channel = 'internal', correlationId, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'follow_up_sent',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: 'event',
    correlationId,
    idempotencyKey: scheduleId ? `beauty_followup:${tenantId}:${scheduleId}` : null,
    payload: metadata,
  });
}

async function requestReview({ tenantId, subjectId, customerId, scheduleId, channel = 'internal', correlationId, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'review_requested',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: 'event',
    correlationId,
    idempotencyKey: scheduleId ? `beauty_review:${tenantId}:${scheduleId}` : null,
    payload: metadata,
  });
}

// ── Reactivation ─────────────────────────────────────────────────────────

async function sendReactivation({ tenantId, subjectId, customerId, channel = 'internal', correlationId, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'reactivation_sent',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'engagement_engine',
    correlationId,
    idempotencyKey: correlationId ? `beauty_reactivation:${tenantId}:${correlationId}` : null,
    payload: metadata,
  });
}

// ── Loyalty reversal ─────────────────────────────────────────────────────

async function reverseLoyaltyPoints({ tenantId, subjectId, customerId, scheduleId, correlationId, reason = 'cancellation', metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'loyalty_points_reversed',
    subjectId,
    customerId,
    scheduleId,
    channel: 'internal',
    triggeredBy: 'event',
    correlationId,
    idempotencyKey: scheduleId ? `loyalty_reversal:${tenantId}:${scheduleId}` : null,
    payload: { reason, ...metadata },
  });
}

// ── Session balance ───────────────────────────────────────────────────────

async function getCustomerSessionBalance({ tenantId, subjectId }) {
  return getSessionBalance({ tenantId, vertical: VERTICAL, subjectId });
}

// ── Loyalty balance ───────────────────────────────────────────────────────

/**
 * Compute loyalty point balance for a subject from the event_ledger.
 * Aggregates LoyaltyPointsGranted minus LoyaltyPointsReversed events.
 *
 * @returns {{ points: number, granted: number, reversed: number, lastUpdatedAt: string|null }}
 */
async function getLoyaltyBalance({ tenantId, subjectId }) {
  const { getSequelize } = require('../../db/sequelize');
  if (!getSequelize()) return { points: 0, granted: 0, reversed: 0, lastUpdatedAt: null };

  const { EventLedger } = require('../../db/models');
  const Model = EventLedger();
  if (!Model) return { points: 0, granted: 0, reversed: 0, lastUpdatedAt: null };

  const { Op } = require('sequelize');
  const rows = await Model.findAll({
    where: {
      tenant_key: tenantId,
      type: { [Op.in]: ['LoyaltyPointsGranted', 'LoyaltyPointsReversed'] },
      // match subject in the payload — stored under subject.id
    },
    order: [['occurred_at', 'DESC']],
    limit: 2000,
  }).catch(() => []);

  let granted = 0;
  let reversed = 0;
  let lastUpdatedAt = null;

  for (const r of rows) {
    const d = r.toJSON ? r.toJSON() : r;
    const sid = d.subject?.id || d.payload?.subjectId || '';
    if (sid !== String(subjectId)) continue;

    const pts = Number(d.payload?.points) || 1;
    if (d.type === 'LoyaltyPointsGranted') granted += pts;
    else if (d.type === 'LoyaltyPointsReversed') reversed += pts;
    if (!lastUpdatedAt) lastUpdatedAt = d.occurred_at;
  }

  return { points: Math.max(0, granted - reversed), granted, reversed, lastUpdatedAt };
}

module.exports = {
  sendConfirmation,
  recordConfirmationReceived,
  sendReminder24h,
  sendReminderNearTime,
  detectNoShow,
  recordServiceCompleted,
  sendFollowUp,
  requestReview,
  sendReactivation,
  reverseLoyaltyPoints,
  getCustomerSessionBalance,
  getLoyaltyBalance,
};
