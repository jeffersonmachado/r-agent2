'use strict';

const { Op } = require('sequelize');
const {
  VerticalJourneyEvent,
  VerticalAttendance,
  VerticalEngagementSignal,
  AccessMembership,
  ExecutionJob,
  EventLedger,
} = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { computeVerticalMetrics } = require('./vertical/verticalMetricsEngine');
const {
  beautyNoShowRisk,
  beautyReengagementSuggestion,
  beautyUpsellSuggestion,
  fitnessChurnRisk,
  fitnessLowFrequencySuggestion,
  fitnessBlockFollowUpSuggestion,
} = require('./vertical/verticalRecommendationService');

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

function dbAvailable() {
  return !!getSequelize();
}

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

async function computeSummary({ tenantId, vertical = 'all', startDate, endDate }) {
  const tid = ensureTenant(tenantId);
  const selectedVertical = normalizeVertical(vertical);
  const period = normalizePeriod({ startDate, endDate, defaultWindowDays: 30 });

  if (!dbAvailable()) {
    return {
      tenantId: tid,
      vertical: selectedVertical,
      period,
      summary: {
        beauty: null,
        fitness: null,
        system: null,
      },
      byVertical: {},
      meta: {
        warnings: ['db_unavailable'],
        derivedMetrics: [],
      },
    };
  }

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const journeyWhere = {
    tenant_key: tid,
    occurred_at: { [Op.between]: [period.startDate, period.endDate] },
  };

  const attendanceWhere = {
    tenant_key: tid,
    checked_in_at: { [Op.between]: [period.startDate, period.endDate] },
  };

  const executionWhere = {
    tenant_key: tid,
    kind: { [Op.like]: 'vertical_%' },
    created_at: { [Op.between]: [period.startDate, period.endDate] },
  };

  const [
    journeyRows,
    attendanceRows,
    engagementRows,
    membershipsRows,
    jobsRows,
    notificationLedgerRows,
    beautyMetrics,
    fitnessMetrics,
  ] = await Promise.all([
    VerticalJourneyEvent().findAll({
      where: journeyWhere,
      attributes: ['vertical', 'event_type', 'occurred_at', 'channel', 'status', 'subject_id'],
      limit: 20000,
    }).catch(() => []),
    VerticalAttendance().findAll({
      where: attendanceWhere,
      attributes: ['vertical', 'status', 'checked_in_at', 'subject_id'],
      limit: 20000,
    }).catch(() => []),
    VerticalEngagementSignal().findAll({
      where: {
        tenant_key: tid,
        vertical: 'fitness',
        computed_at: { [Op.between]: [period.startDate, period.endDate] },
      },
      attributes: ['subject_id', 'signal_type', 'score', 'computed_at'],
      order: [['computed_at', 'DESC']],
      limit: 20000,
    }).catch(() => []),
    AccessMembership().findAll({
      where: { tenant_key: tid, vertical: { [Op.in]: ['beauty', 'fitness'] } },
      attributes: ['id', 'vertical', 'billing_status', 'status', 'subject_id'],
      limit: 20000,
    }).catch(() => []),
    ExecutionJob().findAll({
      where: executionWhere,
      attributes: ['id', 'status', 'attempts', 'processing_at', 'updated_at'],
      limit: 20000,
    }).catch(() => []),
    EventLedger().findAll({
      where: {
        tenant_key: tid,
        type: 'VerticalJourney_Custom',
        source: { [Op.like]: 'vertical.notification.%' },
        occurred_at: { [Op.between]: [period.startDate, period.endDate] },
      },
      attributes: ['payload', 'occurred_at'],
      limit: 20000,
    }).catch(() => []),
    computeVerticalMetrics({ tenantId: tid, vertical: 'beauty', windowDays: 30 }).catch(() => null),
    computeVerticalMetrics({ tenantId: tid, vertical: 'fitness', windowDays: 30 }).catch(() => null),
  ]);

  const journeys = journeyRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const attendances = attendanceRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const engagementSignals = engagementRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const memberships = membershipsRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const jobs = jobsRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const notificationEvents = notificationLedgerRows
    .map((r) => (r.toJSON ? r.toJSON() : r))
    .filter((row) => row?.payload?.kind === 'notification_delivery');

  const latestSignalBySubject = {};
  for (const row of engagementSignals) {
    const subjectId = safeString(row.subject_id || '');
    if (!subjectId || latestSignalBySubject[subjectId]) continue;
    latestSignalBySubject[subjectId] = row;
  }

  const beautyJourneyToday = journeys.filter((item) => {
    if (item.vertical !== 'beauty') return false;
    const dt = safeDate(item.occurred_at, null);
    if (!dt) return false;
    return dt >= todayStart && dt <= todayEnd;
  });

  const fitnessAttendanceToday = attendances.filter((item) => {
    if (item.vertical !== 'fitness') return false;
    const dt = safeDate(item.checked_in_at, null);
    if (!dt) return false;
    return dt >= todayStart && dt <= todayEnd;
  });

  const beautySummary = {
    appointmentsToday: beautyJourneyToday.filter((x) => x.event_type === 'confirmation_sent').length,
    completedServices: beautyJourneyToday.filter((x) => x.event_type === 'service_completed').length,
    noShow: beautyJourneyToday.filter((x) => x.event_type === 'no_show_detected').length,
    reactivations: beautyJourneyToday.filter((x) => x.event_type === 'reactivation_sent').length,
  };

  const fitnessSummary = {
    checkInsToday: fitnessAttendanceToday.length,
    activeStudents: memberships.filter((m) => m.vertical === 'fitness' && m.billing_status === 'active').length,
    lowFrequency: Object.values(latestSignalBySubject).filter((s) => s.signal_type === 'low_frequency').length,
    blocked: memberships.filter((m) => m.vertical === 'fitness' && m.billing_status === 'blocked').length,
  };

  const jobsExecuted = jobs.filter((j) => j.status === 'done' || j.status === 'dead').length;
  const jobsError = jobs.filter((j) => j.status === 'dead').length;

  const notificationsSent = notificationEvents.filter((e) => normalizeNotificationStatus(e?.payload?.dashboardStatus) === 'sent').length;
  const notificationFailures = notificationEvents.filter((e) => normalizeNotificationStatus(e?.payload?.dashboardStatus) === 'failed').length;

  const systemSummary = {
    jobsExecuted,
    jobsError,
    notificationsSent,
    notificationFailures,
  };

  const byVertical = {
    beauty: beautyMetrics,
    fitness: fitnessMetrics,
  };

  const outputSummary = {
    beauty: selectedVertical === 'fitness' ? null : beautySummary,
    fitness: selectedVertical === 'beauty' ? null : fitnessSummary,
    system: systemSummary,
  };

  return {
    tenantId: tid,
    vertical: selectedVertical,
    period,
    summary: outputSummary,
    byVertical,
    meta: {
      warnings: [],
      derivedMetrics: [
        {
          metric: 'beauty.appointmentsToday',
          source: 'VerticalJourneyEvent(event_type=confirmation_sent)',
          exact: false,
          note: 'Proxy de agendamentos confirmados no dia.',
        },
        {
          metric: 'fitness.lowFrequency',
          source: 'VerticalEngagementSignal(latest signal_type=low_frequency)',
          exact: false,
          note: 'Derivado do sinal mais recente por aluno no período.',
        },
      ],
    },
  };
}

async function listTimeline({
  tenantId,
  vertical = 'all',
  subjectId = null,
  customerId = null,
  membershipId = null,
  startDate,
  endDate,
  status = null,
  page = 1,
  limit = 50,
}) {
  const tid = ensureTenant(tenantId);
  const selectedVertical = normalizeVertical(vertical);
  const selectedStatus = normalizeStatus(status);
  const safeLimit = normalizeLimit(limit, 50, 200);
  const safePage = normalizePage(page, 1);
  const period = normalizePeriod({ startDate, endDate, defaultWindowDays: 90 });

  if (!dbAvailable()) {
    return {
      tenantId: tid,
      vertical: selectedVertical,
      period,
      items: [],
      pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 1 },
      meta: { warnings: ['db_unavailable'] },
    };
  }

  const verticalFilter = selectedVertical === 'all' ? { [Op.in]: ['beauty', 'fitness'] } : selectedVertical;

  const journeyWhere = {
    tenant_key: tid,
    vertical: verticalFilter,
    occurred_at: { [Op.between]: [period.startDate, period.endDate] },
  };
  if (subjectId) journeyWhere.subject_id = safeString(subjectId);
  if (customerId) journeyWhere.customer_id = safeString(customerId);
  if (membershipId) journeyWhere.membership_id = safeString(membershipId);

  const attendanceWhere = {
    tenant_key: tid,
    vertical: verticalFilter,
    checked_in_at: { [Op.between]: [period.startDate, period.endDate] },
  };
  if (subjectId) attendanceWhere.subject_id = safeString(subjectId);
  if (membershipId) attendanceWhere.membership_id = safeString(membershipId);

  const membershipHistoryWhere = {
    tenant_key: tid,
    type: 'MembershipBillingStatusChanged',
    occurred_at: { [Op.between]: [period.startDate, period.endDate] },
  };
  if (membershipId) membershipHistoryWhere.correlation_id = safeString(membershipId);

  const [journeyRows, attendanceRows, membershipHistoryRows] = await Promise.all([
    VerticalJourneyEvent().findAll({
      where: journeyWhere,
      order: [['occurred_at', 'DESC']],
      limit: Math.min(safeLimit * 10, 800),
    }).catch(() => []),
    VerticalAttendance().findAll({
      where: attendanceWhere,
      order: [['checked_in_at', 'DESC']],
      limit: Math.min(safeLimit * 10, 800),
    }).catch(() => []),
    EventLedger().findAll({
      where: membershipHistoryWhere,
      order: [['occurred_at', 'DESC']],
      limit: Math.min(safeLimit * 10, 800),
    }).catch(() => []),
  ]);

  const journeyItems = journeyRows.map((row) => {
    const item = row.toJSON ? row.toJSON() : row;
    return {
      timestamp: toIso(item.occurred_at),
      eventType: item.event_type,
      status: classifyJourneyStatus(item),
      origin: 'vertical_journey_events',
      vertical: item.vertical,
      subjectId: item.subject_id || null,
      customerId: item.customer_id || null,
      membershipId: item.membership_id || null,
      channel: item.channel || null,
      details: {
        triggeredBy: item.triggered_by || null,
        scheduleId: item.schedule_id || null,
        payload: item.payload || {},
      },
    };
  });

  const attendanceItems = [];
  for (const row of attendanceRows) {
    const item = row.toJSON ? row.toJSON() : row;
    if (item.checked_in_at) {
      attendanceItems.push({
        timestamp: toIso(item.checked_in_at),
        eventType: 'check_in',
        status: 'success',
        origin: 'vertical_attendances',
        vertical: item.vertical,
        subjectId: item.subject_id || null,
        customerId: null,
        membershipId: item.membership_id || null,
        channel: null,
        details: {
          attendanceId: item.id,
          unitId: item.unit_id || null,
          deviceId: item.device_id || null,
          rawStatus: item.status,
        },
      });
    }

    if (item.checked_out_at) {
      attendanceItems.push({
        timestamp: toIso(item.checked_out_at),
        eventType: 'check_out',
        status: item.status === 'absent' ? 'failed' : 'success',
        origin: 'vertical_attendances',
        vertical: item.vertical,
        subjectId: item.subject_id || null,
        customerId: null,
        membershipId: item.membership_id || null,
        channel: null,
        details: {
          attendanceId: item.id,
          durationMinutes: item.duration_minutes,
          rawStatus: item.status,
        },
      });
    }
  }

  const membershipItems = membershipHistoryRows.map((row) => {
    const item = row.toJSON ? row.toJSON() : row;
    const payload = item.payload || {};
    const inferredVertical = safeString(payload.vertical || '').toLowerCase();
    return {
      timestamp: toIso(item.occurred_at),
      eventType: 'membership_billing_status_changed',
      status: 'success',
      origin: 'event_ledger',
      vertical: inferredVertical === 'fitness' || inferredVertical === 'beauty' ? inferredVertical : 'fitness',
      subjectId: item.subject_id || payload.subjectId || null,
      customerId: payload.customerId || null,
      membershipId: item.correlation_id || payload.membershipId || null,
      channel: null,
      details: {
        fromStatus: payload.fromStatus || null,
        toStatus: payload.toStatus || null,
        reason: payload.reason || null,
        actor: item.actor_id || null,
      },
    };
  });

  let items = [...journeyItems, ...attendanceItems, ...membershipItems]
    .filter((item) => !!item.timestamp)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (selectedVertical !== 'all') {
    items = items.filter((item) => item.vertical === selectedVertical);
  }

  if (selectedStatus) {
    items = items.filter((item) => item.status === selectedStatus);
  }

  if (subjectId) {
    items = items.filter((item) => safeString(item.subjectId) === safeString(subjectId));
  }
  if (customerId) {
    items = items.filter((item) => safeString(item.customerId) === safeString(customerId));
  }
  if (membershipId) {
    items = items.filter((item) => safeString(item.membershipId) === safeString(membershipId));
  }

  const paged = applyPagination(items, { page: safePage, limit: safeLimit });

  return {
    tenantId: tid,
    vertical: selectedVertical,
    period,
    items: paged.items,
    pagination: paged.pagination,
    meta: {
      warnings: [],
    },
  };
}

async function listJobs({
  tenantId,
  vertical = 'all',
  startDate,
  endDate,
  status = null,
  page = 1,
  limit = 50,
}) {
  const tid = ensureTenant(tenantId);
  const selectedVertical = normalizeVertical(vertical);
  const selectedStatus = normalizeStatus(status);
  const safePage = normalizePage(page, 1);
  const safeLimit = normalizeLimit(limit, 50, 200);
  const period = normalizePeriod({ startDate, endDate, defaultWindowDays: 30 });

  if (!dbAvailable()) {
    return {
      tenantId: tid,
      vertical: selectedVertical,
      period,
      summary: null,
      byKind: [],
      items: [],
      pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 1 },
      meta: { warnings: ['db_unavailable'] },
    };
  }

  const where = {
    tenant_key: tid,
    kind: { [Op.like]: 'vertical_%' },
    created_at: { [Op.between]: [period.startDate, period.endDate] },
  };

  if (selectedVertical === 'beauty') {
    where.kind = { [Op.in]: ['vertical_beauty_journey_tick', 'vertical_beauty_noshow_scan', 'vertical_beauty_reactivation_scan', 'vertical_reconciliation'] };
  } else if (selectedVertical === 'fitness') {
    where.kind = { [Op.in]: ['vertical_fitness_journey_tick', 'vertical_fitness_inactivity_scan', 'vertical_fitness_grace_expiry_scan', 'vertical_reconciliation'] };
  }

  const rows = await ExecutionJob().findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: 5000,
  }).catch(() => []);

  let jobs = rows.map((row) => {
    const item = row.toJSON ? row.toJSON() : row;
    const normalizedStatus = mapExecutionStatus(item.status);
    const durationMs = computeDurationMs(item);
    return {
      id: item.id,
      kind: item.kind,
      tenantId: item.tenant_key,
      status: normalizedStatus,
      startedAt: toIso(item.processing_at || item.created_at),
      finishedAt: normalizedStatus === 'pending' ? null : toIso(item.updated_at),
      durationMs,
      attempt: Number(item.attempts || 0) + (item.status === 'dead' || item.status === 'done' ? 1 : 0),
      retries: Math.max(Number(item.attempts || 0), 0),
      error: item.last_error ? safeString(item.last_error).slice(0, 240) : null,
      rawStatus: item.status,
      priority: item.priority,
      nextAttemptAt: toIso(item.next_attempt_at),
    };
  });

  if (selectedStatus) {
    jobs = jobs.filter((job) => job.status === selectedStatus);
  }

  const executed = jobs.filter((j) => j.status === 'success' || j.status === 'failed').length;
  const success = jobs.filter((j) => j.status === 'success').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const pending = jobs.filter((j) => j.status === 'pending').length;
  const retries = jobs.reduce((sum, j) => sum + Math.max(Number(j.retries || 0), 0), 0);

  const durations = jobs.map((j) => j.durationMs).filter((v) => Number.isFinite(v));
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((acc, v) => acc + v, 0) / durations.length)
    : null;

  const byKindMap = {};
  for (const job of jobs) {
    if (!byKindMap[job.kind]) {
      byKindMap[job.kind] = {
        kind: job.kind,
        executed: 0,
        success: 0,
        failed: 0,
        pending: 0,
        retries: 0,
        lastExecution: null,
      };
    }
    const bucket = byKindMap[job.kind];
    if (job.status === 'success' || job.status === 'failed') bucket.executed += 1;
    if (job.status === 'success') bucket.success += 1;
    if (job.status === 'failed') bucket.failed += 1;
    if (job.status === 'pending') bucket.pending += 1;
    bucket.retries += job.retries;

    if (!bucket.lastExecution || new Date(job.startedAt).getTime() > new Date(bucket.lastExecution.startedAt).getTime()) {
      bucket.lastExecution = {
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        durationMs: job.durationMs,
        error: job.error,
      };
    }
  }

  const byKind = Object.values(byKindMap).sort((a, b) => a.kind.localeCompare(b.kind));
  const paged = applyPagination(jobs, { page: safePage, limit: safeLimit });

  return {
    tenantId: tid,
    vertical: selectedVertical,
    period,
    summary: {
      executed,
      success,
      failed,
      avgDurationMs,
      retries,
      backlogEstimated: pending,
      pending,
    },
    byKind,
    items: paged.items,
    pagination: paged.pagination,
    meta: { warnings: [] },
  };
}

async function listNotifications({
  tenantId,
  vertical = 'all',
  startDate,
  endDate,
  status = null,
  channel = null,
  page = 1,
  limit = 50,
}) {
  const tid = ensureTenant(tenantId);
  const selectedVertical = normalizeVertical(vertical);
  const selectedStatus = normalizeStatus(status);
  const selectedChannel = normalizeChannel(channel);
  const safePage = normalizePage(page, 1);
  const safeLimit = normalizeLimit(limit, 50, 200);
  const period = normalizePeriod({ startDate, endDate, defaultWindowDays: 30 });

  if (!dbAvailable()) {
    return {
      tenantId: tid,
      vertical: selectedVertical,
      period,
      summary: null,
      items: [],
      pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 1 },
      meta: { warnings: ['db_unavailable'] },
    };
  }

  const ledgerRows = await EventLedger().findAll({
    where: {
      tenant_key: tid,
      type: 'VerticalJourney_Custom',
      source: { [Op.like]: 'vertical.notification.%' },
      occurred_at: { [Op.between]: [period.startDate, period.endDate] },
    },
    order: [['occurred_at', 'DESC']],
    limit: 6000,
  }).catch(() => []);

  let items = ledgerRows
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

  const warnings = [];

  if (!items.length) {
    warnings.push('notification_delivery_events_not_found_using_journey_proxy');
    const proxyRows = await VerticalJourneyEvent().findAll({
      where: {
        tenant_key: tid,
        occurred_at: { [Op.between]: [period.startDate, period.endDate] },
        channel: { [Op.ne]: null },
      },
      order: [['occurred_at', 'DESC']],
      limit: 6000,
    }).catch(() => []);

    items = proxyRows
      .map((row) => (row.toJSON ? row.toJSON() : row))
      .filter((row) => {
        return BEAUTY_NOTIFICATION_EVENT_TYPES.has(row.event_type) || FITNESS_NOTIFICATION_EVENT_TYPES.has(row.event_type);
      })
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

  if (selectedVertical !== 'all') {
    items = items.filter((item) => item.vertical === selectedVertical);
  }

  if (selectedStatus) {
    items = items.filter((item) => item.status === selectedStatus);
  }

  if (selectedChannel) {
    items = items.filter((item) => item.channel === selectedChannel);
  }

  items = items
    .filter((item) => !!item.timestamp)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

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

  const paged = applyPagination(items, { page: safePage, limit: safeLimit });

  return {
    tenantId: tid,
    vertical: selectedVertical,
    period,
    summary: {
      sent,
      failed,
      skipped,
      providerDependent,
      byChannel,
    },
    items: paged.items,
    pagination: paged.pagination,
    meta: {
      warnings,
      dataSource: warnings.length ? 'vertical_journey_proxy' : 'event_ledger_notification_delivery',
    },
  };
}

async function collectBeautyCandidates({ tenantId, startDate, endDate, limit }) {
  const [journeyRows, attendanceRows, membershipRows] = await Promise.all([
    VerticalJourneyEvent().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'beauty',
        occurred_at: { [Op.between]: [startDate, endDate] },
      },
      attributes: ['subject_id', 'customer_id', 'membership_id'],
      limit: Math.max(limit * 5, 100),
      order: [['occurred_at', 'DESC']],
    }).catch(() => []),
    VerticalAttendance().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'beauty',
        checked_in_at: { [Op.between]: [startDate, endDate] },
      },
      attributes: ['subject_id', 'membership_id'],
      limit: Math.max(limit * 5, 100),
      order: [['checked_in_at', 'DESC']],
    }).catch(() => []),
    AccessMembership().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'beauty',
      },
      attributes: ['id', 'subject_id', 'customer_id', 'billing_status'],
      limit: Math.max(limit * 5, 100),
      order: [['updated_at', 'DESC']],
    }).catch(() => []),
  ]);

  const bySubject = {};

  for (const row of journeyRows) {
    const item = row.toJSON ? row.toJSON() : row;
    const subjectKey = safeString(item.subject_id || item.customer_id || '');
    if (!subjectKey || bySubject[subjectKey]) continue;
    bySubject[subjectKey] = {
      subjectId: item.subject_id || item.customer_id,
      customerId: item.customer_id || null,
      membershipId: item.membership_id || null,
      billingStatus: 'active',
    };
  }

  for (const row of attendanceRows) {
    const item = row.toJSON ? row.toJSON() : row;
    const subjectKey = safeString(item.subject_id || '');
    if (!subjectKey || bySubject[subjectKey]) continue;
    bySubject[subjectKey] = {
      subjectId: item.subject_id,
      customerId: null,
      membershipId: item.membership_id || null,
      billingStatus: 'active',
    };
  }

  for (const row of membershipRows) {
    const item = row.toJSON ? row.toJSON() : row;
    const subjectKey = safeString(item.subject_id || item.customer_id || '');
    if (!subjectKey || bySubject[subjectKey]) continue;
    bySubject[subjectKey] = {
      subjectId: item.subject_id || item.customer_id,
      customerId: item.customer_id || null,
      membershipId: item.id || null,
      billingStatus: item.billing_status || 'active',
    };
  }

  return Object.values(bySubject).slice(0, Math.max(limit * 2, 20));
}

async function collectFitnessCandidates({ tenantId, limit }) {
  const rows = await AccessMembership().findAll({
    where: {
      tenant_key: tenantId,
      vertical: 'fitness',
    },
    attributes: ['id', 'subject_id', 'customer_id', 'billing_status'],
    order: [['updated_at', 'DESC']],
    limit: Math.max(limit * 4, 100),
  }).catch(() => []);

  return rows
    .map((row) => (row.toJSON ? row.toJSON() : row))
    .map((item) => ({
      subjectId: item.subject_id,
      customerId: item.customer_id || null,
      membershipId: item.id,
      billingStatus: item.billing_status || 'active',
    }))
    .filter((item) => !!item.subjectId)
    .slice(0, Math.max(limit * 2, 20));
}

async function listInsights({
  tenantId,
  vertical = 'all',
  startDate,
  endDate,
  limit = 25,
}) {
  const tid = ensureTenant(tenantId);
  const selectedVertical = normalizeVertical(vertical);
  const safeLimit = normalizeLimit(limit, 25, 100);
  const period = normalizePeriod({ startDate, endDate, defaultWindowDays: 30 });

  if (!dbAvailable()) {
    return {
      tenantId: tid,
      vertical: selectedVertical,
      period,
      items: [],
      summary: { total: 0, byVertical: { beauty: 0, fitness: 0 } },
      meta: { warnings: ['db_unavailable'] },
    };
  }

  const items = [];

  if (selectedVertical === 'all' || selectedVertical === 'beauty') {
    const candidates = await collectBeautyCandidates({
      tenantId: tid,
      startDate: period.startDate,
      endDate: period.endDate,
      limit: safeLimit,
    });

    for (const candidate of candidates) {
      const noShow = await beautyNoShowRisk({
        tenantId: tid,
        subjectId: candidate.subjectId,
        membershipId: candidate.membershipId,
      }).catch(() => null);

      if (noShow && (Number(noShow.score) >= 0.4 || noShow.action !== 'none')) {
        items.push({
          vertical: 'beauty',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'no_show_risk',
          action: noShow.action,
          score: Number(noShow.score) || 0,
          scoreSource: 'engine',
          reason: noShow.reason,
          evidence: noShow.evidence || {},
        });
      }

      const reengagement = await beautyReengagementSuggestion({
        tenantId: tid,
        subjectId: candidate.subjectId,
        membershipId: candidate.membershipId,
      }).catch(() => null);

      if (reengagement && reengagement.suggestion !== 'none') {
        const signalScore = scoreFromSignal(reengagement.evidence);
        items.push({
          vertical: 'beauty',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'return_eligibility',
          action: reengagement.suggestion,
          score: Number.isFinite(signalScore) ? signalScore : 0.6,
          scoreSource: Number.isFinite(signalScore) ? 'engine' : 'derived',
          reason: reengagement.reason,
          evidence: reengagement.evidence || {},
        });
      }

      const upsell = await beautyUpsellSuggestion({
        tenantId: tid,
        subjectId: candidate.subjectId,
      }).catch(() => null);

      if (upsell && upsell.suggestion !== 'none') {
        items.push({
          vertical: 'beauty',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'upsell_opportunity',
          action: upsell.suggestion,
          score: derivedScoreForSuggestion('beauty_upsell', upsell.suggestion),
          scoreSource: 'derived',
          reason: upsell.reason,
          evidence: upsell.evidence || {},
        });
      }
    }
  }

  if (selectedVertical === 'all' || selectedVertical === 'fitness') {
    const candidates = await collectFitnessCandidates({ tenantId: tid, limit: safeLimit });

    for (const candidate of candidates) {
      const churn = await fitnessChurnRisk({
        tenantId: tid,
        subjectId: candidate.subjectId,
        membershipId: candidate.membershipId,
        billingStatus: candidate.billingStatus,
      }).catch(() => null);

      if (churn && (Number(churn.score) >= 0.4 || churn.action !== 'none')) {
        items.push({
          vertical: 'fitness',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'churn_risk',
          action: churn.action,
          score: Number(churn.score) || 0,
          scoreSource: 'engine',
          reason: churn.reason,
          evidence: churn.evidence || {},
        });
      }

      const lowFrequency = await fitnessLowFrequencySuggestion({
        tenantId: tid,
        subjectId: candidate.subjectId,
      }).catch(() => null);

      if (lowFrequency && lowFrequency.suggestion !== 'none') {
        const signalScore = scoreFromSignal(lowFrequency.evidence);
        items.push({
          vertical: 'fitness',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'low_frequency',
          action: lowFrequency.suggestion,
          score: Number.isFinite(signalScore) ? signalScore : 0.65,
          scoreSource: Number.isFinite(signalScore) ? 'engine' : 'derived',
          reason: lowFrequency.reason,
          evidence: lowFrequency.evidence || {},
        });
      }

      const blockFollowup = fitnessBlockFollowUpSuggestion({
        membershipId: candidate.membershipId,
        billingStatus: candidate.billingStatus,
        blockCount: 0,
      });

      if (blockFollowup && blockFollowup.suggestion !== 'none') {
        items.push({
          vertical: 'fitness',
          subjectId: candidate.subjectId,
          customerId: candidate.customerId,
          membershipId: candidate.membershipId,
          type: 'membership_block_followup',
          action: blockFollowup.suggestion,
          score: derivedScoreForSuggestion('fitness_block_followup', blockFollowup.suggestion),
          scoreSource: 'derived',
          reason: blockFollowup.reason,
          evidence: blockFollowup.evidence || {},
        });
      }
    }
  }

  const dedupMap = new Map();
  for (const item of items) {
    const key = [item.vertical, item.type, item.subjectId || '-', item.membershipId || '-'].join(':');
    if (!dedupMap.has(key)) {
      dedupMap.set(key, item);
    }
  }

  const deduped = Array.from(dedupMap.values())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, safeLimit);

  const summary = {
    total: deduped.length,
    byVertical: {
      beauty: deduped.filter((i) => i.vertical === 'beauty').length,
      fitness: deduped.filter((i) => i.vertical === 'fitness').length,
    },
  };

  return {
    tenantId: tid,
    vertical: selectedVertical,
    period,
    items: deduped,
    summary,
    meta: {
      warnings: [],
      derivedMetrics: [
        {
          field: 'score (upsell/block_followup)',
          note: 'Quando o engine não retorna score numérico, o painel usa score derivado mapeado por tipo de sugestão.',
        },
      ],
    },
  };
}

module.exports = {
  computeSummary,
  listTimeline,
  listJobs,
  listNotifications,
  listInsights,
  helpers: {
    normalizeNotificationStatus,
    classifyJourneyStatus,
    mapExecutionStatus,
  },
};
