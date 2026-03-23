'use strict';

const VALID_VERTICALS = new Set(['all', 'beauty', 'fitness']);
const VALID_STATUSES = new Set(['success', 'failed', 'pending', 'provider-dependent']);
const VALID_CHANNELS = new Set(['whatsapp', 'email', 'sms', 'internal']);

const BEAUTY_NOTIFICATION_EVENT_TYPES = new Set([
  'confirmation_sent',
  'reminder_24h',
  'reminder_1h',
  'follow_up_sent',
  'reactivation_sent',
  'rescheduling_offered',
  'review_requested',
]);

const FITNESS_NOTIFICATION_EVENT_TYPES = new Set([
  'welcome_sent',
  'frequency_alert_sent',
  'return_campaign_sent',
]);

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeDate(value, fallback = null) {
  if (!value) return fallback;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return fallback;
  return dt;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 86400000);
}

function normalizePeriod({ startDate, endDate, defaultWindowDays = 30 }) {
  const end = safeDate(endDate, new Date());
  const start = safeDate(startDate, daysAgo(defaultWindowDays));
  if (start > end) {
    return {
      startDate: startOfDay(end),
      endDate: endOfDay(start),
      invalidOrder: true,
    };
  }
  return {
    startDate: startOfDay(start),
    endDate: endOfDay(end),
    invalidOrder: false,
  };
}

function normalizeVertical(vertical) {
  const v = safeString(vertical || 'all', 'all').trim().toLowerCase();
  return VALID_VERTICALS.has(v) ? v : 'all';
}

function normalizeStatus(status) {
  if (!status) return null;
  const s = safeString(status).trim().toLowerCase();
  return VALID_STATUSES.has(s) ? s : null;
}

function normalizeChannel(channel) {
  if (!channel) return null;
  const ch = safeString(channel).trim().toLowerCase();
  return VALID_CHANNELS.has(ch) ? ch : null;
}

function normalizeLimit(limit, fallback = 25, max = 200) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function normalizePage(page, fallback = 1) {
  const n = Number(page);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function journeyEventVertical(eventType) {
  if (BEAUTY_NOTIFICATION_EVENT_TYPES.has(eventType)) return 'beauty';
  if (FITNESS_NOTIFICATION_EVENT_TYPES.has(eventType)) return 'fitness';
  return null;
}

function isNotificationJourneyEventType(eventType) {
  return BEAUTY_NOTIFICATION_EVENT_TYPES.has(eventType) || FITNESS_NOTIFICATION_EVENT_TYPES.has(eventType);
}

function classifyJourneyStatus(row) {
  const base = safeString(row?.status || '').trim().toLowerCase();
  const channel = safeString(row?.channel || '').trim().toLowerCase();
  const eventType = safeString(row?.event_type || '').trim().toLowerCase();

  if (base === 'failed' || base === 'error') return 'failed';
  if (base === 'pending') return 'pending';

  if (channel && channel !== 'internal') {
    if (BEAUTY_NOTIFICATION_EVENT_TYPES.has(eventType) || FITNESS_NOTIFICATION_EVENT_TYPES.has(eventType)) {
      return 'provider-dependent';
    }
  }

  return 'success';
}

function mapExecutionStatus(status) {
  const s = safeString(status).trim().toLowerCase();
  if (s === 'done') return 'success';
  if (s === 'dead') return 'failed';
  if (s === 'processing' || s === 'pending') return 'pending';
  return 'pending';
}

function toIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function computeDurationMs(job) {
  const start = safeDate(job.processing_at || null, null);
  const end = safeDate(job.updated_at || null, null);
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  return ms >= 0 ? ms : null;
}

function maskDestination(value) {
  const text = safeString(value || '', '');
  if (!text) return '-';
  if (text.includes('@')) {
    const [name, domain] = text.split('@');
    if (!domain) return '***';
    const userMasked = name.length <= 2 ? `${name[0] || '*'}*` : `${name.slice(0, 2)}***`;
    return `${userMasked}@${domain}`;
  }
  if (text.length <= 4) return `${text[0] || '*'}***`;
  return `${text.slice(0, 3)}***${text.slice(-2)}`;
}

function normalizeNotificationStatus(value) {
  const s = safeString(value).trim().toLowerCase();
  if (s === 'sent') return 'sent';
  if (s === 'failed') return 'failed';
  if (s === 'skipped') return 'skipped';
  if (s === 'provider-dependent') return 'provider-dependent';
  return 'provider-dependent';
}

function inferNotificationVertical(eventType) {
  const v = journeyEventVertical(eventType);
  return v || 'unknown';
}

function scoreFromSignal(signal) {
  const score = Number(signal?.score);
  if (Number.isFinite(score)) return score;
  return null;
}

function derivedScoreForSuggestion(kind, suggestion) {
  if (kind === 'beauty_upsell') {
    if (suggestion === 'renew_package') return 0.8;
    if (suggestion === 'offer_subscription') return 0.75;
    if (suggestion === 'upgrade_to_subscription') return 0.7;
    return 0.2;
  }
  if (kind === 'fitness_block_followup') {
    if (suggestion === 'manual_contact_priority') return 0.9;
    if (suggestion === 'automated_payment_reminder') return 0.65;
    return 0.2;
  }
  return null;
}

function applyPagination(items, { page, limit }) {
  const total = items.length;
  const offset = (page - 1) * limit;
  const paged = items.slice(offset, offset + limit);
  return {
    items: paged,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

function ensureTenant(tenantId) {
  const tid = safeString(tenantId || '').trim();
  if (!tid) {
    const err = new Error('tenantId required');
    err.code = 'missing_tenant';
    throw err;
  }
  return tid;
}

module.exports = {
  safeString,
  safeDate,
  startOfDay,
  endOfDay,
  normalizePeriod,
  normalizeVertical,
  normalizeStatus,
  normalizeChannel,
  normalizeLimit,
  normalizePage,
  classifyJourneyStatus,
  mapExecutionStatus,
  toIso,
  computeDurationMs,
  maskDestination,
  normalizeNotificationStatus,
  inferNotificationVertical,
  scoreFromSignal,
  derivedScoreForSuggestion,
  applyPagination,
  ensureTenant,
  isNotificationJourneyEventType,
};