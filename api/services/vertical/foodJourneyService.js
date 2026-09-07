'use strict';

/**
 * Food Journey Service
 *
 * Orchestrates the Food vertical journey on top of the existing order domain
 * (api/services/orderService.js — status machine created→confirmed→preparing→
 * ready→dispatched→delivered, per-transition notifications, SLA metrics).
 *
 * This service adds the customer-journey layer that the order domain does not
 * cover:
 * - Payment confirmation recorded on the customer journey
 * - Post-delivery review request (avaliação)
 * - Reorder campaign (recompra) for customers overdue for a new order
 *
 * Uses customerJourneyEngine for idempotent event storage.
 * Terminology: pedido, entrega, avaliação, recompra, fidelização.
 */

const { emitJourneyEvent } = require('./customerJourneyEngine');
const { enqueueNotification } = require('../notificationService');

const VERTICAL = 'food';

async function queueFoodNotification({
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

/**
 * Record payment confirmation on the customer journey.
 * Idempotent per order.
 */
async function recordPaymentConfirmed({ tenantId, subjectId = null, customerId = null, orderId, orderNumber = null, amount = null, channel = 'internal', correlationId = null, metadata = {} }) {
  return emitJourneyEvent({
    tenantId,
    vertical: metadata.vertical || VERTICAL,
    eventType: 'confirmation_received',
    subjectId,
    customerId,
    channel,
    triggeredBy: 'order_service',
    correlationId,
    idempotencyKey: orderId ? `food_payment:${tenantId}:${orderId}` : null,
    payload: { context: 'order_payment', orderId, orderNumber, paymentStatus: 'paid', amount, ...metadata },
  });
}

/**
 * Request a review (avaliação) after delivery.
 * Idempotent per order.
 */
async function requestReview({ tenantId, subjectId = null, customerId = null, orderId, orderNumber = null, channel = 'whatsapp', correlationId = null, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'review_requested',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'scheduler',
    correlationId,
    idempotencyKey: orderId ? `food_review:${tenantId}:${orderId}` : null,
    payload: { context: 'post_delivery', orderId, orderNumber, ...metadata },
  });
  await queueFoodNotification({ tenantId, channel, subjectId, customerId, eventType: 'review_requested', metadata: { ...metadata, orderId, orderNumber } });
  return evt;
}

/**
 * Send a reorder campaign (recompra) to a customer overdue for a new order.
 * Idempotent per campaign key.
 */
async function sendReorderCampaign({ tenantId, subjectId = null, customerId = null, channel = 'whatsapp', correlationId = null, metadata = {} }) {
  const campaignKey = metadata.campaignKey || correlationId;
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'return_campaign_sent',
    subjectId,
    customerId,
    channel,
    triggeredBy: metadata.triggeredBy || 'scheduler',
    correlationId,
    idempotencyKey: campaignKey ? `food_reorder:${tenantId}:${campaignKey}` : null,
    payload: { reason: 'reorder_due', ...metadata },
  });
  await queueFoodNotification({ tenantId, channel, subjectId, customerId, eventType: 'return_campaign_sent', metadata: { ...metadata, reason: 'reorder_due' } });
  return evt;
}

module.exports = {
  VERTICAL,
  recordPaymentConfirmed,
  requestReview,
  sendReorderCampaign,
};
