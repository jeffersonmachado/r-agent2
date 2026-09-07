'use strict';

/**
 * Services Journey Service
 *
 * Orchestrates the Services vertical journey:
 * - Quote (orçamento) sent → approved / declined / expired
 * - Quote follow-up for unanswered quotes
 * - Service scheduling after approval
 * - Service delivery (execution) + post-service follow-up
 * - Charge (cobrança) issued on quote approval via billingService
 * - Reactivation for inactive customers
 *
 * Uses customerJourneyEngine for idempotent event storage and
 * billingService.createCharge for the billing record (charges ARE the
 * financial state-of-record; journey events carry the commercial timeline).
 * Terminology: orçamento, aprovação, execução, cobrança, retorno.
 */

const { emitJourneyEvent } = require('./customerJourneyEngine');
const { appendEventV1 } = require('../eventLedgerService');
const { enqueueNotification } = require('../notificationService');

const VERTICAL = 'services';

async function queueServicesNotification({
  tenantId,
  channel = 'whatsapp',
  subjectId = null,
  customerId = null,
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
    recipient: customerId || subjectId || null,
    metadata: { ...metadata, vertical: VERTICAL },
  }).catch(() => {});
}

// ── Quote (orçamento) ────────────────────────────────────────────────────

/**
 * Send a quote to the customer. Idempotent per quoteId.
 */
async function sendQuote({ tenantId, subjectId = null, customerId = null, quoteId, amount = null, items = [], validDays = 15, channel = 'internal', correlationId = null, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'quote_sent',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'manual',
    correlationId,
    idempotencyKey: quoteId ? `services_quote:${tenantId}:${quoteId}` : null,
    payload: { quoteId, amount, items, validDays, ...metadata },
  });
  await queueServicesNotification({ tenantId, channel, subjectId, customerId, eventType: 'quote_sent', metadata: { ...metadata, quoteId, amount } });
  return evt;
}

/**
 * Record quote approval. Chains:
 * - charge (cobrança) issued via billingService (idempotent per quote)
 * - charge_issued journey event
 */
async function recordQuoteApproved({ tenantId, subjectId = null, customerId = null, quoteId, amount = null, dueDate = null, correlationId = null, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'quote_approved',
    subjectId,
    customerId,
    channel: 'internal',
    triggeredBy: metadata.triggeredBy || 'event',
    correlationId,
    idempotencyKey: quoteId ? `services_quote_approved:${tenantId}:${quoteId}` : null,
    payload: { quoteId, amount, ...metadata },
  });

  // Cobrança: registro financeiro real via billingService (idempotente por quote)
  if (quoteId && Number(amount) > 0) {
    try {
      const billingService = require('../billingService');
      await billingService.createCharge({
        tenantId,
        vertical: VERTICAL,
        type: 'one_time',
        subjectId,
        customerId,
        amount,
        dueDate,
        idempotencyKey: `services_charge:${tenantId}:${quoteId}`,
        metadata: { quoteId, source: 'quote_approval' },
      });

      await emitJourneyEvent({
        tenantId,
        vertical: VERTICAL,
        eventType: 'charge_issued',
        subjectId,
        customerId,
        channel: 'internal',
        triggeredBy: 'event',
        correlationId,
        idempotencyKey: `services_charge_evt:${tenantId}:${quoteId}`,
        payload: { quoteId, amount, dueDate },
      });
    } catch (err) {
      // DB indisponível não pode ser mascarada: cobrança exige persistência
      if (String(err?.code || '') === 'billing_db_unavailable') throw err;
      const logger = require('../../utils/logger');
      logger.warn('[Services] charge emission failed', { tenantId, quoteId, error: err?.message });
    }
  }

  return evt;
}

/**
 * Record quote decline.
 */
async function recordQuoteDeclined({ tenantId, subjectId = null, customerId = null, quoteId, reason = null, correlationId = null, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'quote_declined',
    subjectId,
    customerId,
    channel: 'internal',
    triggeredBy: metadata.triggeredBy || 'event',
    correlationId,
    idempotencyKey: quoteId ? `services_quote_declined:${tenantId}:${quoteId}` : null,
    payload: { quoteId, reason, ...metadata },
  });
}

/**
 * Expire an unanswered quote (called by the scheduler).
 */
async function expireQuote({ tenantId, subjectId = null, customerId = null, quoteId, correlationId = null, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'quote_expired',
    subjectId,
    customerId,
    channel: 'internal',
    triggeredBy: 'scheduler',
    correlationId,
    idempotencyKey: quoteId ? `services_quote_expired:${tenantId}:${quoteId}` : null,
    payload: { quoteId, ...metadata },
  });
}

/**
 * Send a follow-up for an unanswered quote. Idempotent per (quote, follow-up seq).
 */
async function sendQuoteFollowUp({ tenantId, subjectId = null, customerId = null, quoteId, sequence = 1, channel = 'whatsapp', correlationId = null, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'quote_follow_up_sent',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'scheduler',
    correlationId,
    idempotencyKey: quoteId ? `services_quote_followup:${tenantId}:${quoteId}:${sequence}` : null,
    payload: { quoteId, sequence, ...metadata },
  });
  await queueServicesNotification({ tenantId, channel, subjectId, customerId, eventType: 'quote_follow_up_sent', metadata: { ...metadata, quoteId, sequence } });
  return evt;
}

// ── Service execution ────────────────────────────────────────────────────

/**
 * Record service scheduling (after quote approval).
 */
async function recordServiceScheduled({ tenantId, subjectId = null, customerId = null, quoteId = null, scheduleId = null, scheduledAt = null, correlationId = null, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'pre_service',
    subjectId,
    customerId,
    scheduleId,
    channel: 'internal',
    triggeredBy: metadata.triggeredBy || 'manual',
    correlationId,
    idempotencyKey: scheduleId ? `services_scheduled:${tenantId}:${scheduleId}` : null,
    payload: { quoteId, scheduled_at: scheduledAt, ...metadata },
  });
}

/**
 * Record service delivery (execution completed). Chains post-service follow-up.
 */
async function recordServiceDelivered({ tenantId, subjectId = null, customerId = null, quoteId = null, scheduleId = null, correlationId = null, metadata = {} }) {
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
    idempotencyKey: (scheduleId || quoteId) ? `services_delivered:${tenantId}:${scheduleId || quoteId}` : null,
    payload: { quoteId, ...metadata },
  });

  await appendEventV1({
    tenantId,
    type: 'ServicesJobDelivered',
    source: `vertical.journey.${VERTICAL}`,
    occurredAt: new Date(),
    correlationId: scheduleId || quoteId || correlationId,
    subject: { type: 'services_customer', id: subjectId || customerId || 'unknown' },
    actor: { type: 'system', id: 'services_journey' },
    idempotencyKey: (scheduleId || quoteId) ? `services_delivered_ledger:${tenantId}:${scheduleId || quoteId}` : null,
    payload: { subjectId, customerId, quoteId, scheduleId },
  }).catch(() => {});

  // Follow-up pós-serviço (encadeado, idempotente)
  await sendFollowUp({ tenantId, subjectId, customerId, scheduleId, correlationId, metadata: { quoteId, ...metadata } }).catch(() => {});

  return evt;
}

async function sendFollowUp({ tenantId, subjectId = null, customerId = null, scheduleId = null, channel = 'internal', correlationId = null, metadata = {} }) {
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
    idempotencyKey: scheduleId ? `services_followup:${tenantId}:${scheduleId}` : null,
    payload: { context: 'post_service', ...metadata },
  });
  await queueServicesNotification({ tenantId, channel, subjectId, customerId, eventType: 'follow_up_sent', metadata });
  return evt;
}

// ── Reactivation ─────────────────────────────────────────────────────────

async function sendReactivation({ tenantId, subjectId = null, customerId = null, channel = 'internal', correlationId = null, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'reactivation_sent',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'engagement_engine',
    correlationId,
    idempotencyKey: correlationId ? `services_reactivation:${tenantId}:${correlationId}` : null,
    payload: metadata,
  });
  await queueServicesNotification({ tenantId, channel, subjectId, customerId, eventType: 'reactivation_sent', metadata });
  return evt;
}

module.exports = {
  VERTICAL,
  sendQuote,
  recordQuoteApproved,
  recordQuoteDeclined,
  expireQuote,
  sendQuoteFollowUp,
  recordServiceScheduled,
  recordServiceDelivered,
  sendFollowUp,
  sendReactivation,
};
