'use strict';

/**
 * Clinic Journey Service
 *
 * Orchestrates the complete Clinic vertical journey:
 * - Appointment (consulta) confirmation (sent / received)
 * - 24h and near-time reminders
 * - Patient check-in (chegada)
 * - No-show (falta) detection and re-offer (reagendamento/encaixe)
 * - Waitlist slot offer (lista de espera → encaixe)
 * - Consultation completion + post-consultation follow-up (orientações)
 * - Periodic recall / return (retorno) campaign
 * - Reactivation for inactive patients
 *
 * Uses customerJourneyEngine for idempotent event storage.
 * Terminology is clinical: consulta, encaixe, lista de espera, recall, retorno.
 */

const { emitJourneyEvent } = require('./customerJourneyEngine');
const { appendEventV1 } = require('../eventLedgerService');
const { enqueueNotification } = require('../notificationService');

const VERTICAL = 'clinic';

async function queueClinicNotification({
  tenantId,
  channel = 'whatsapp',
  subjectId = null,
  customerId = null,
  scheduleId = null,
  eventType,
  metadata = {},
}) {
  const normalizedChannel = String(channel || '').trim().toLowerCase();
  if (!normalizedChannel || normalizedChannel === 'internal') return;
  await enqueueNotification({
    tenantId,
    vertical: VERTICAL,
    channel: normalizedChannel,
    eventType,
    subjectId,
    customerId,
    scheduleId,
    recipient: customerId || subjectId || null,
    metadata: { ...metadata, vertical: VERTICAL },
  }).catch(() => {});
}

// ── Confirmation ─────────────────────────────────────────────────────────

/**
 * Send consultation confirmation to patient.
 */
async function sendConfirmation({ tenantId, subjectId, customerId, scheduleId, channel = 'internal', correlationId, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'confirmation_sent',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: metadata.triggeredBy || 'manual',
    correlationId,
    idempotencyKey: scheduleId ? `clinic_confirmation:${tenantId}:${scheduleId}` : null,
    payload: { message: 'Consultation confirmation sent', ...metadata },
  });
  await queueClinicNotification({ tenantId, channel, subjectId, customerId, scheduleId, eventType: 'confirmation_sent', metadata });
  return evt;
}

/**
 * Record that confirmation was received / acknowledged by the patient.
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
    idempotencyKey: scheduleId ? `clinic_conf_recv:${tenantId}:${scheduleId}` : null,
    payload: metadata,
  });
}

// ── Reminders ────────────────────────────────────────────────────────────

async function sendReminder24h({ tenantId, subjectId, customerId, scheduleId, channel = 'internal', correlationId, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'reminder_24h',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: 'scheduler',
    correlationId,
    idempotencyKey: scheduleId ? `clinic_reminder24h:${tenantId}:${scheduleId}` : null,
    payload: { message: '24h consultation reminder sent', ...metadata },
  });
  await queueClinicNotification({ tenantId, channel, subjectId, customerId, scheduleId, eventType: 'reminder_24h', metadata });
  return evt;
}

async function sendReminderNearTime({ tenantId, subjectId, customerId, scheduleId, channel = 'internal', correlationId, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'reminder_1h',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: 'scheduler',
    correlationId,
    idempotencyKey: scheduleId ? `clinic_reminder1h:${tenantId}:${scheduleId}` : null,
    payload: { message: 'Near-time consultation reminder sent', ...metadata },
  });
  await queueClinicNotification({ tenantId, channel, subjectId, customerId, scheduleId, eventType: 'reminder_1h', metadata });
  return evt;
}

// ── Arrival (check-in) ────────────────────────────────────────────────────

/**
 * Record patient arrival for the consultation.
 */
async function recordCheckIn({ tenantId, subjectId, customerId, scheduleId, correlationId, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'checkin_recorded',
    subjectId,
    customerId,
    scheduleId,
    channel: 'internal',
    triggeredBy: metadata.triggeredBy || 'manual',
    correlationId,
    idempotencyKey: scheduleId ? `clinic_checkin:${tenantId}:${scheduleId}` : null,
    payload: metadata,
  });
}

// ── No-show (falta) ───────────────────────────────────────────────────────

/**
 * Detect and record a no-show. Automatically offers rescheduling (encaixe).
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
    idempotencyKey: scheduleId ? `clinic_noshow:${tenantId}:${scheduleId}` : null,
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
    idempotencyKey: scheduleId ? `clinic_reoferta:${tenantId}:${scheduleId}` : null,
    payload: { trigger: 'no_show', ...metadata },
  }).catch(() => {});

  await queueClinicNotification({
    tenantId,
    channel: metadata.channel || 'whatsapp',
    subjectId,
    customerId,
    scheduleId,
    eventType: 'no_show_detected',
    metadata,
  });

  return evt;
}

/**
 * Offer a waitlist slot (lista de espera → encaixe) when a slot opens up.
 */
async function offerWaitlistSlot({ tenantId, subjectId, customerId, scheduleId, channel = 'whatsapp', correlationId, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'rescheduling_offered',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: metadata.triggeredBy || 'manual',
    correlationId,
    idempotencyKey: scheduleId ? `clinic_waitlist:${tenantId}:${scheduleId}:${subjectId || customerId}` : null,
    payload: { trigger: 'waitlist_slot', ...metadata },
  });
  await queueClinicNotification({ tenantId, channel, subjectId, customerId, scheduleId, eventType: 'rescheduling_offered', metadata: { ...metadata, trigger: 'waitlist_slot' } });
  return evt;
}

// ── Consultation completion ───────────────────────────────────────────────

/**
 * Record consultation completion:
 * - emits service_completed event
 * - sends post-consultation follow-up (orientações) chained, idempotent
 */
async function recordConsultationCompleted({ tenantId, subjectId, customerId, scheduleId, correlationId, metadata = {} }) {
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
    idempotencyKey: scheduleId ? `clinic_completed:${tenantId}:${scheduleId}` : null,
    payload: metadata,
  });

  // Ledger event for consultation outcome (best-effort)
  await appendEventV1({
    tenantId,
    type: 'ClinicConsultationCompleted',
    source: `vertical.journey.${VERTICAL}`,
    occurredAt: new Date(),
    correlationId: scheduleId || correlationId,
    subject: { type: 'clinic_patient', id: subjectId || customerId || 'unknown' },
    actor: { type: 'system', id: 'clinic_journey' },
    idempotencyKey: scheduleId ? `clinic_consult_ledger:${tenantId}:${scheduleId}` : null,
    payload: { subjectId, customerId, scheduleId, ...metadata },
  }).catch(() => {});

  // Post-consultation follow-up (orientações) — chained, idempotent
  await sendFollowUp({ tenantId, subjectId, customerId, scheduleId, correlationId, metadata }).catch(() => {});

  return evt;
}

// ── Follow-up (orientações pós-consulta) ─────────────────────────────────

async function sendFollowUp({ tenantId, subjectId, customerId, scheduleId, channel = 'internal', correlationId, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'follow_up_sent',
    subjectId,
    customerId,
    scheduleId,
    channel,
    triggeredBy: 'event',
    correlationId,
    idempotencyKey: scheduleId ? `clinic_followup:${tenantId}:${scheduleId}` : null,
    payload: { context: 'post_consultation', ...metadata },
  });
  await queueClinicNotification({ tenantId, channel, subjectId, customerId, scheduleId, eventType: 'follow_up_sent', metadata });
  return evt;
}

// ── Recall / retorno ─────────────────────────────────────────────────────

/**
 * Send periodic recall (retorno) campaign to a patient due for return.
 */
async function sendRecall({ tenantId, subjectId, customerId, channel = 'internal', correlationId, metadata = {} }) {
  const recallKey = metadata.recallKey || correlationId;
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'return_campaign_sent',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'scheduler',
    correlationId,
    idempotencyKey: recallKey ? `clinic_recall:${tenantId}:${recallKey}` : null,
    payload: { reason: 'periodic_recall', ...metadata },
  });
  await queueClinicNotification({ tenantId, channel, subjectId, customerId, eventType: 'return_campaign_sent', metadata: { ...metadata, reason: 'periodic_recall' } });
  return evt;
}

// ── Reactivation ─────────────────────────────────────────────────────────

async function sendReactivation({ tenantId, subjectId, customerId, channel = 'internal', correlationId, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'reactivation_sent',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'engagement_engine',
    correlationId,
    idempotencyKey: correlationId ? `clinic_reactivation:${tenantId}:${correlationId}` : null,
    payload: metadata,
  });
  await queueClinicNotification({ tenantId, channel, subjectId, customerId, eventType: 'reactivation_sent', metadata });
  return evt;
}

module.exports = {
  VERTICAL,
  sendConfirmation,
  recordConfirmationReceived,
  sendReminder24h,
  sendReminderNearTime,
  recordCheckIn,
  detectNoShow,
  offerWaitlistSlot,
  recordConsultationCompleted,
  sendFollowUp,
  sendRecall,
  sendReactivation,
};
