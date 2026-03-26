'use strict';

const notificationService = require('../notificationService');

async function sendJourneyNotification({
  tenantId,
  channel = 'internal',
  subjectId = null,
  customerId = null,
  membershipId = null,
  eventType,
  payload = {},
}) {
  const out = await notificationService.sendJourneyNotification({
    tenantId,
    channel,
    subjectId,
    customerId,
    membershipId,
    scheduleId: payload?.scheduleId || null,
    bundleId: payload?.bundleId || null,
    transactionId: payload?.transactionId || null,
    appointmentId: payload?.appointmentId || null,
    vertical: payload?.vertical || null,
    metadata: payload || {},
    message: payload?.message || null,
    eventType,
    recipient: payload?.recipient || customerId || subjectId || null,
  });
  // Normalize to flat shape so consumers can access .status / .isStub directly.
  const delivery = out?.delivery || {};
  const result = out?.result || {};
  return {
    ok: out?.ok !== false,
    status: delivery.status || result.status || (out?.ok === false ? 'failed' : 'unknown'),
    isStub: !!(result.isStub || delivery.status === 'stub'),
    deduplicated: !!out?.deduplicated,
    delivery,
    result,
    error: out?.error || null,
  };
}

async function broadcastJourneyNotification({ tenantId, channels = ['internal'], ...rest }) {
  const results = await Promise.all(
    (Array.isArray(channels) ? channels : ['internal']).map((channel) => (
      sendJourneyNotification({ tenantId, channel, ...rest }).catch((err) => ({
        ok: false,
        error: err?.message || 'notification_broadcast_failed',
        channel,
      }))
    )),
  );
  return { ok: results.every((item) => item?.ok !== false), results };
}

// CHANNEL_STATUS: alias exported for validation scripts and external consumers.
// Maps semantic channel-layer outcomes to the canonical DELIVERY_STATUS values.
const CHANNEL_STATUS = {
  SENT: notificationService.DELIVERY_STATUS.SENT,           // 'sent'
  STUB: notificationService.DELIVERY_STATUS.STUB,           // 'stub'
  ERROR: notificationService.DELIVERY_STATUS.FAILED,        // 'failed'
  SKIPPED: notificationService.DELIVERY_STATUS.SKIPPED,     // 'skipped'
  DISABLED: 'disabled',                                     // channel disabled
};

module.exports = {
  DELIVERY_STATUS: notificationService.DELIVERY_STATUS,
  CHANNEL_STATUS,
  sendJourneyNotification,
  broadcastJourneyNotification,
};
