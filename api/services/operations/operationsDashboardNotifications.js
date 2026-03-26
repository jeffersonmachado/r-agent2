'use strict';

function mapLedgerNotificationItems(ledgerRows, helpers) {
  const {
    safeString,
    inferNotificationVertical,
    normalizeChannel,
    normalizeNotificationStatus,
    toIso,
    maskDestination,
  } = helpers;

  return ledgerRows
    .map((row) => (row.toJSON ? row.toJSON() : row))
    .filter((row) => row?.payload?.kind === 'notification_delivery')
    .map((row) => {
      const payload = row.payload || {};
      const messageType = safeString(payload.eventType || '');
      const inferredVertical = payload.vertical || inferNotificationVertical(messageType);
      const resolvedChannel = normalizeChannel(payload.channel || row.source.split('.').pop()) || 'internal';
      const resolvedStatus = normalizeNotificationStatus(payload.dashboardStatus || payload.deliveryStatus);
      return {
        timestamp: toIso(row.occurred_at),
        channel: resolvedChannel,
        destination: payload.destinationMasked || maskDestination(payload.destination || ''),
        status: resolvedStatus,
        messageType,
        error: payload.error || null,
        isStub: !!payload.isStub,
        providerStatus: payload.adapterStatus || null,
        vertical: inferredVertical,
        origin: 'event_ledger_notification_delivery',
      };
    });
}

function mapNotificationDeliveryItems(notificationRows, helpers) {
  const {
    safeString,
    inferNotificationVertical,
    normalizeChannel,
    normalizeNotificationStatus,
    toIso,
    maskDestination,
  } = helpers;

  return (notificationRows || [])
    .map((row) => (row.toJSON ? row.toJSON() : row))
    .map((row) => {
      const messageType = safeString(row.event_type || '');
      const inferredVertical = row.vertical || inferNotificationVertical(messageType);
      const resolvedChannel = normalizeChannel(row.channel) || 'internal';
      const resolvedStatus = normalizeNotificationStatus(row.status);
      return {
        id: row.id,
        timestamp: toIso(row.sent_at || row.last_attempt_at || row.created_at),
        channel: resolvedChannel,
        destination: row.recipient_masked || maskDestination(row.recipient_resolved || row.recipient || ''),
        status: resolvedStatus,
        messageType,
        error: row.last_error || null,
        isStub: row.status === 'stub',
        providerStatus: row.provider || null,
        vertical: inferredVertical,
        attempts: Number(row.attempts || 0),
        jobId: row.execution_job_id || null,
        subjectId: row.subject_id || null,
        customerId: row.customer_id || null,
        membershipId: row.membership_id || null,
        bundleId: row.bundle_id || null,
        transactionId: row.transaction_id || null,
        scheduleId: row.schedule_id || null,
        origin: 'notification_deliveries',
      };
    });
}

function mapJourneyProxyNotificationItems(proxyRows, helpers) {
  const {
    normalizeChannel,
    inferNotificationVertical,
    toIso,
    maskDestination,
    isNotificationJourneyEventType,
  } = helpers;

  return proxyRows
    .map((row) => (row.toJSON ? row.toJSON() : row))
    .filter((row) => isNotificationJourneyEventType(row.event_type))
    .map((row) => {
      const channelValue = normalizeChannel(row.channel) || 'internal';
      const inferredVertical = row.vertical || inferNotificationVertical(row.event_type);
      const statusValue = channelValue === 'internal' ? 'skipped' : 'provider-dependent';
      return {
        timestamp: toIso(row.occurred_at),
        channel: channelValue,
        destination: maskDestination(row.customer_id || row.subject_id || ''),
        status: statusValue,
        messageType: row.event_type,
        error: null,
        isStub: null,
        providerStatus: null,
        vertical: inferredVertical,
        origin: 'vertical_journey_proxy',
      };
    });
}

function filterAndSortNotificationItems(items, { selectedVertical, selectedStatus, selectedChannel }) {
  let filtered = Array.isArray(items) ? items.slice() : [];

  if (selectedVertical !== 'all') {
    filtered = filtered.filter((item) => item.vertical === selectedVertical);
  }

  if (selectedStatus) {
    filtered = filtered.filter((item) => item.status === selectedStatus);
  }

  if (selectedChannel) {
    filtered = filtered.filter((item) => item.channel === selectedChannel);
  }

  filtered = filtered
    .filter((item) => !!item.timestamp)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return filtered;
}

function summarizeNotificationItems(items) {
  const byChannel = {
    whatsapp: { sent: 0, failed: 0, skipped: 0, providerDependent: 0 },
    email: { sent: 0, failed: 0, skipped: 0, providerDependent: 0 },
    sms: { sent: 0, failed: 0, skipped: 0, providerDependent: 0 },
    internal: { sent: 0, failed: 0, skipped: 0, providerDependent: 0 },
  };

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let providerDependent = 0;

  for (const item of items) {
    if (!byChannel[item.channel]) continue;
    if (item.status === 'sent') {
      sent += 1;
      byChannel[item.channel].sent += 1;
    } else if (item.status === 'failed') {
      failed += 1;
      byChannel[item.channel].failed += 1;
    } else if (item.status === 'skipped') {
      skipped += 1;
      byChannel[item.channel].skipped += 1;
    } else {
      providerDependent += 1;
      byChannel[item.channel].providerDependent += 1;
    }
  }

  return {
    sent,
    failed,
    skipped,
    providerDependent,
    byChannel,
  };
}

module.exports = {
  mapNotificationDeliveryItems,
  mapLedgerNotificationItems,
  mapJourneyProxyNotificationItems,
  filterAndSortNotificationItems,
  summarizeNotificationItems,
};
