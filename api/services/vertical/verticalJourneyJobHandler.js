'use strict';

/**
 * Vertical Journey Job Handler
 *
 * Processes execution-queue jobs for both Beauty and Fitness verticals.
 * Registered in executionQueueService.processJob for kinds:
 *   - vertical_beauty_journey_tick
 *   - vertical_fitness_journey_tick
 *   - vertical_beauty_noshow_scan
 *   - vertical_fitness_inactivity_scan
 *   - vertical_fitness_grace_expiry_scan
 *
 * All operations are:
 *   - Tenant-scoped (tenantId in job.payload)
 *   - Idempotent (uses idempotency keys)
 *   - Best-effort (errors logged, not rethrown for non-critical paths)
 *
 * DESIGN: Each handler reads its own data from DB — no shared state.
 */

const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const { VerticalJourneyEvent, VerticalAttendance, AccessMembership } = require('../../db/models');
const { Op } = require('sequelize');

// ── lazy imports to avoid circular deps ─────────────────────────────────────

function getBeautyService() {
  return require('./beautyJourneyService');
}

function getFitnessService() {
  return require('./fitnessMembershipService');
}

function getEngagementEngine() {
  return require('./engagementEngine');
}

function getNotificationAdapter() {
  return require('../notifications/notificationAdapter');
}

function dbAvailable() {
  return !!getSequelize();
}

// ── helpers ──────────────────────────────────────────────────────────────────

function safeStr(v) {
  try { return String(v ?? ''); } catch (_) { return ''; }
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600000);
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 3600000);
}

function daysAgo(d) {
  return new Date(Date.now() - d * 86400000);
}

/**
 * Wrap a promise with a max execution timeout.
 * Rejects with 'job_timeout' if the promise doesn't settle in time.
 * The timer is .unref()'d so it never prevents process exit.
 */
const JOB_TIMEOUT_MS = Number(process.env.VERTICAL_JOB_TIMEOUT_MS) || 30000;
function withJobTimeout(promise, timeoutMs, label) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : JOB_TIMEOUT_MS;
  const lbl = label || 'vertical_job';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`job_timeout: ${lbl} exceeded ${ms}ms`));
    }, ms);
    t.unref();
    promise.then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────
// BEAUTY HANDLERS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Main beauty tick: scan for scheduled journeys that need automation.
 * payload: { tenantId, windowHours? }
 */
async function handleBeautyJourneyTick(job) {
  const tenantId = safeStr(job?.payload?.tenantId || job?.tenant_key || '');
  if (!tenantId || !dbAvailable()) return;

  const windowHours = Number(job?.payload?.windowHours) || 26; // scan next 26 h
  const beauty = getBeautyService();
  const notify = getNotificationAdapter();

  // ── 1. Find confirmation_sent events without a reminder_24h sent yet ────
  // Proxy: events where event_type = 'confirmation_sent' and scheduled_at within [now, now+windowHours]
  // We use vertical_journey_events as proxy for schedule + confirmation state.
  try {
    const confirmations = await VerticalJourneyEvent().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'beauty',
        event_type: 'confirmation_sent',
        occurred_at: { [Op.gte]: daysAgo(1) }, // recent confirmations
      },
      limit: 100,
    }).catch(() => []);

    for (const c of confirmations) {
      const row = c.toJSON ? c.toJSON() : c;
      const scheduleId = row.schedule_id;
      const subjectId = row.subject_id;
      const customerId = row.customer_id;
      if (!scheduleId) continue;

      // Skip if 24h reminder already sent
      const existing24h = await VerticalJourneyEvent().findOne({
        where: { tenant_key: tenantId, vertical: 'beauty', event_type: 'reminder_24h', schedule_id: scheduleId },
      }).catch(() => null);
      if (existing24h) continue;

      // Check if appointment time is ~24h away using payload.scheduled_at
      const scheduledAt = row.payload?.scheduled_at || row.metadata?.scheduled_at;
      if (!scheduledAt) continue;
      const apptMs = new Date(scheduledAt).getTime();
      if (!Number.isFinite(apptMs)) continue;

      const now = Date.now();
      const hoursUntil = (apptMs - now) / 3600000;
      if (hoursUntil > 0 && hoursUntil <= windowHours) {
        // Send 24h reminder
        try {
          const evt = await beauty.sendReminder24h({ tenantId, subjectId, customerId, scheduleId });
          await notify.sendJourneyNotification({
            tenantId,
            channel: row.channel || 'internal',
            subjectId,
            customerId,
            eventType: 'reminder_24h',
            payload: { scheduleId, scheduledAt },
          }).catch(() => {});
          logger.info('[VerticalJourney] beauty reminder_24h sent', { tenantId, scheduleId });
        } catch (err) {
          logger.warn('[VerticalJourney] beauty reminder_24h failed', { tenantId, scheduleId, error: err?.message });
        }
      } else if (hoursUntil > 0 && hoursUntil <= 1.5) {
        // Near-time: send 1h reminder
        const existing1h = await VerticalJourneyEvent().findOne({
          where: { tenant_key: tenantId, vertical: 'beauty', event_type: 'reminder_1h', schedule_id: scheduleId },
        }).catch(() => null);
        if (!existing1h) {
          try {
            await beauty.sendReminderNearTime({ tenantId, subjectId, customerId, scheduleId });
            await notify.sendJourneyNotification({
              tenantId, channel: row.channel || 'internal', subjectId, customerId,
              eventType: 'reminder_1h', payload: { scheduleId, scheduledAt },
            }).catch(() => {});
          } catch (err) {
            logger.warn('[VerticalJourney] beauty reminder_1h failed', { tenantId, scheduleId, error: err?.message });
          }
        }
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] beauty tick reminders error', { tenantId, error: err?.message });
  }

  // ── 2. No-show scan: appointments that passed with no service_completed ─
  await handleBeautyNoShowScan({ tenantId });
}

/**
 * Scan for beauty no-shows: confirmation_sent > 2h ago, no service_completed.
 */
async function handleBeautyNoShowScan({ tenantId, payload } = {}) {
  const tid = safeStr(tenantId || payload?.tenantId || '');
  if (!tid || !dbAvailable()) return;
  const beauty = getBeautyService();
  const notify = getNotificationAdapter();

  try {
    const candidatesSince = hoursAgo(48);
    const candidatesUntil = hoursAgo(2); // at least 2h past appointment time

    const candidates = await VerticalJourneyEvent().findAll({
      where: {
        tenant_key: tid,
        vertical: 'beauty',
        event_type: 'confirmation_sent',
        occurred_at: { [Op.between]: [candidatesSince, candidatesUntil] },
      },
      limit: 100,
    }).catch(() => []);

    for (const c of candidates) {
      const row = c.toJSON ? c.toJSON() : c;
      const scheduleId = row.schedule_id;
      if (!scheduleId) continue;

      // Check appointment time from payload
      const scheduledAt = row.payload?.scheduled_at || row.metadata?.scheduled_at;
      if (scheduledAt) {
        const apptMs = new Date(scheduledAt).getTime();
        if (Number.isFinite(apptMs) && apptMs > Date.now()) continue; // future – skip
      }

      // Skip if already service_completed or no_show_detected
      const completed = await VerticalJourneyEvent().findOne({
        where: {
          tenant_key: tid,
          vertical: 'beauty',
          event_type: { [Op.in]: ['service_completed', 'no_show_detected'] },
          schedule_id: scheduleId,
        },
      }).catch(() => null);
      if (completed) continue;

      // Mark as no-show
      try {
        await beauty.detectNoShow({
          tenantId: tid,
          subjectId: row.subject_id,
          customerId: row.customer_id,
          scheduleId,
          metadata: { triggeredBy: 'scheduler', source: 'no_show_scan' },
        });
        await notify.sendJourneyNotification({
          tenantId: tid,
          channel: 'internal',
          subjectId: row.subject_id,
          customerId: row.customer_id,
          eventType: 'no_show_detected',
          payload: { scheduleId },
        }).catch(() => {});
        logger.info('[VerticalJourney] beauty no_show_detected', { tenantId: tid, scheduleId });
      } catch (err) {
        logger.warn('[VerticalJourney] beauty noshow detect failed', { tenantId: tid, scheduleId, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] beauty no-show scan failed', { tenantId: tid, error: err?.message });
  }
}

/**
 * Beauty reactivation scan: subjects inactive for ≥60 days without recent reactivation.
 */
async function handleBeautyReactivationScan({ tenantId: tid, payload } = {}) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;
  const beauty = getBeautyService();
  const notify = getNotificationAdapter();
  const { computeEngagementSignal } = getEngagementEngine();

  try {
    // Find all subjects with any beauty attendance
    const since = daysAgo(90);
    const attendances = await VerticalAttendance().findAll({
      where: { tenant_key: tenantId, vertical: 'beauty', checked_in_at: { [Op.gte]: since } },
      attributes: ['subject_id', 'checked_in_at'],
      limit: 1000,
    }).catch(() => []);

    // Build a set of recently active subjects
    const recentSubjects = new Set(attendances.map((a) => safeStr((a.toJSON ? a.toJSON() : a).subject_id)));

    // Find subjects who have OLD attendances (>60 days ago) but none recent
    const oldAttendances = await VerticalAttendance().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'beauty',
        checked_in_at: { [Op.lt]: daysAgo(60) },
      },
      attributes: ['subject_id'],
      group: ['subject_id'],
      limit: 500,
    }).catch(() => []);

    const candidateSubjects = oldAttendances
      .map((a) => safeStr((a.toJSON ? a.toJSON() : a).subject_id))
      .filter((sid) => sid && !recentSubjects.has(sid));

    for (const subjectId of candidateSubjects.slice(0, 50)) {
      // Check if reactivation was sent in last 30 days
      const recentReactivation = await VerticalJourneyEvent().findOne({
        where: {
          tenant_key: tenantId,
          vertical: 'beauty',
          event_type: 'reactivation_sent',
          subject_id: subjectId,
          occurred_at: { [Op.gte]: daysAgo(30) },
        },
      }).catch(() => null);
      if (recentReactivation) continue;

      try {
        await beauty.sendReactivation({
          tenantId,
          subjectId,
          metadata: { triggeredBy: 'scheduler', source: 'reactivation_scan' },
        });
        await notify.sendJourneyNotification({
          tenantId, channel: 'internal', subjectId,
          eventType: 'reactivation_sent', payload: { triggeredBy: 'scheduler' },
        }).catch(() => {});
        logger.info('[VerticalJourney] beauty reactivation sent', { tenantId, subjectId });
      } catch (err) {
        logger.warn('[VerticalJourney] beauty reactivation failed', { tenantId, subjectId, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] beauty reactivation scan failed', { tenantId, error: err?.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FITNESS HANDLERS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Main fitness tick: scan for inactivity, low frequency, and engagement signals.
 * payload: { tenantId }
 */
async function handleFitnessJourneyTick(job) {
  const tenantId = safeStr(job?.payload?.tenantId || job?.tenant_key || '');
  if (!tenantId || !dbAvailable()) return;

  // Close stale open attendances first (>8h without check-out = absent)
  try {
    const { closeStaleOpenAttendances } = require('./fitnessAttendanceService');
    const result = await closeStaleOpenAttendances({ tenantId, maxOpenHours: 8 });
    if (result.closed > 0) {
      logger.info('[VerticalJourney] fitness stale attendances closed', { tenantId, closed: result.closed });
    }
  } catch (err) {
    logger.warn('[VerticalJourney] fitness stale attendance close failed', { tenantId, error: err?.message });
  }

  await handleFitnessInactivityScan({ tenantId });
  await handleFitnessGraceExpiryScan({ tenantId });
}

/**
 * Scan for fitness subjects with low frequency / inactivity and dispatch alerts.
 */
async function handleFitnessInactivityScan({ tenantId: tid, payload } = {}) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;

  const fitness = getFitnessService();
  const notify = getNotificationAdapter();
  const { computeEngagementSignal } = getEngagementEngine();

  try {
    // Enumerate active fitness memberships for the tenant
    const Model = AccessMembership();
    const memberships = await Model.findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'fitness',
        billing_status: { [Op.in]: ['active', 'delinquent', 'grace_period'] },
      },
      attributes: ['id', 'subject_id', 'billing_status'],
      limit: 500,
    }).catch(() => []);

    for (const m of memberships) {
      const row = m.toJSON ? m.toJSON() : m;
      const subjectId = safeStr(row.subject_id);
      const membershipId = safeStr(row.id);
      const billingStatus = safeStr(row.billing_status || 'active');
      if (!subjectId) continue;

      let signal;
      try {
        signal = await computeEngagementSignal({ tenantId, vertical: 'fitness', subjectId, membershipId, billingStatus });
      } catch {
        continue;
      }

      if (!signal || signal.signal_type === 'healthy') continue;

      if (signal.signal_type === 'churn_risk') {
        // Avoid duplicate churn_risk events in less than 7 days
        const recent = await VerticalJourneyEvent().findOne({
          where: {
            tenant_key: tenantId,
            vertical: 'fitness',
            event_type: 'churn_risk_detected',
            subject_id: subjectId,
            occurred_at: { [Op.gte]: daysAgo(7) },
          },
        }).catch(() => null);
        if (recent) continue;

        await fitness.detectChurnRisk({
          tenantId, subjectId, membershipId,
          daysSinceLastVisit: signal.days_since_last_visit,
          frequency30d: signal.frequency_last_30d,
          billingStatus,
        }).catch(() => {});

        await fitness.sendReturnCampaign({
          tenantId, subjectId, membershipId,
          correlationId: `churn_${tenantId}_${subjectId}_${Date.now()}`,
          metadata: { signal_type: signal.signal_type, score: signal.score, triggeredBy: 'scheduler' },
        }).catch(() => {});

        await notify.sendJourneyNotification({
          tenantId, channel: 'internal', subjectId, membershipId,
          eventType: 'return_campaign_sent',
          payload: { signalType: signal.signal_type, score: signal.score },
        }).catch(() => {});

        logger.info('[VerticalJourney] fitness return_campaign sent', { tenantId, subjectId, score: signal.score });

      } else if (signal.signal_type === 'low_frequency') {
        // Frequency alert: max once per 14 days
        const recentAlert = await VerticalJourneyEvent().findOne({
          where: {
            tenant_key: tenantId,
            vertical: 'fitness',
            event_type: 'frequency_alert_sent',
            subject_id: subjectId,
            occurred_at: { [Op.gte]: daysAgo(14) },
          },
        }).catch(() => null);
        if (recentAlert) continue;

        await fitness.sendFrequencyAlert({
          tenantId, subjectId, membershipId,
          metadata: { frequency30d: signal.frequency_last_30d, triggeredBy: 'scheduler' },
        }).catch(() => {});

        await notify.sendJourneyNotification({
          tenantId, channel: 'internal', subjectId, membershipId,
          eventType: 'frequency_alert_sent',
          payload: { frequency30d: signal.frequency_last_30d },
        }).catch(() => {});

        logger.info('[VerticalJourney] fitness frequency_alert sent', { tenantId, subjectId });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] fitness inactivity scan failed', { tenantId, error: err?.message });
  }
}

/**
 * Scan fitness memberships in grace period whose grace_until has passed → block.
 */
async function handleFitnessGraceExpiryScan({ tenantId: tid, payload } = {}) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;

  const fitness = getFitnessService();

  try {
    const now = new Date();
    const Model = AccessMembership();
    const expired = await Model.findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'fitness',
        billing_status: 'delinquent',
        grace_until: { [Op.lt]: now, [Op.ne]: null },
      },
      limit: 100,
    }).catch(() => []);

    for (const m of expired) {
      const row = m.toJSON ? m.toJSON() : m;
      try {
        await fitness.endGracePeriodWithBlock({ tenantId, membershipId: row.id });
        logger.info('[VerticalJourney] fitness grace_expired → blocked', { tenantId, membershipId: row.id });
      } catch (err) {
        logger.warn('[VerticalJourney] fitness grace expiry block failed', { tenantId, membershipId: row.id, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] fitness grace expiry scan failed', { tenantId, error: err?.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// RECONCILIATION HANDLER
// ────────────────────────────────────────────────────────────────────────────

/**
 * Vertical reconciliation: corrects data inconsistencies across both verticals.
 * Runs at lower priority — once per 6 hours per tenant via scheduler.
 *
 * Currently does:
 *   1. Close open attendances that have been open for > 24 h (conservative threshold)
 *   2. Block fitness memberships whose grace period has expired
 *   3. Log a reconciliation summary for observability
 */
async function handleVerticalReconciliation({ tenantId: tid, payload } = {}) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;

  const startMs = Date.now();
  const summary = { staleAttendancesClosed: 0, graceExpired: 0, errors: [] };

  // 1. Stale open attendances (24 h threshold — conservative for reconciliation)
  try {
    const { closeStaleOpenAttendances } = require('./fitnessAttendanceService');
    const r = await closeStaleOpenAttendances({ tenantId, maxOpenHours: 24 });
    summary.staleAttendancesClosed = r.closed;
  } catch (err) {
    summary.errors.push(`stale_attendance: ${err?.message}`);
    logger.warn('[VerticalJourney] reconciliation: stale attendance close error', { tenantId, error: err?.message });
  }

  // 2. Grace expiry  (idempotent — endGracePeriodWithBlock is no-op if already blocked)
  try {
    await handleFitnessGraceExpiryScan({ tenantId });
  } catch (err) {
    summary.errors.push(`grace_expiry: ${err?.message}`);
    logger.warn('[VerticalJourney] reconciliation: grace expiry error', { tenantId, error: err?.message });
  }

  logger.info('[VerticalJourney] reconciliation complete', {
    tenantId,
    action: 'reconciliation',
    result: summary.errors.length === 0 ? 'ok' : 'partial',
    staleAttendancesClosed: summary.staleAttendancesClosed,
    errorCount: summary.errors.length,
    durationMs: Date.now() - startMs,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// DISPATCH ENTRY POINT
// ────────────────────────────────────────────────────────────────────────────

/**
 * Main dispatch function called by executionQueueService.processJob.
 * Returns true if the kind was handled, false otherwise.
 */
async function handleVerticalJob(job) {
  const kind = safeStr(job?.kind || '');
  const tenantId = safeStr(job?.payload?.tenantId || job?.tenant_key || '');
  const jobId = safeStr(job?.id || '');
  const startMs = Date.now();

  logger.info('[VerticalJourney] job start', { tenantId, kind, jobId });

  try {
    switch (kind) {
      case 'vertical_beauty_journey_tick':
        await withJobTimeout(handleBeautyJourneyTick(job), undefined, kind);
        break;

      case 'vertical_beauty_noshow_scan':
        await withJobTimeout(handleBeautyNoShowScan({ tenantId }), undefined, kind);
        break;

      case 'vertical_beauty_reactivation_scan':
        await withJobTimeout(handleBeautyReactivationScan({ tenantId }), undefined, kind);
        break;

      case 'vertical_fitness_journey_tick':
        await withJobTimeout(handleFitnessJourneyTick(job), undefined, kind);
        break;

      case 'vertical_fitness_inactivity_scan':
        await withJobTimeout(handleFitnessInactivityScan({ tenantId }), undefined, kind);
        break;

      case 'vertical_fitness_grace_expiry_scan':
        await withJobTimeout(handleFitnessGraceExpiryScan({ tenantId }), undefined, kind);
        break;

      case 'vertical_reconciliation':
        await withJobTimeout(handleVerticalReconciliation({ tenantId }), undefined, kind);
        break;

      default:
        return false;
    }

    logger.info('[VerticalJourney] job done', { tenantId, kind, jobId, result: 'ok', durationMs: Date.now() - startMs });
    return true;
  } catch (err) {
    logger.warn('[VerticalJourney] job failed', { tenantId, kind, jobId, result: 'error', error: err?.message, durationMs: Date.now() - startMs });
    throw err; // let executionQueueService handle retry/dead
  }
}

module.exports = {
  handleVerticalJob,
  handleBeautyJourneyTick,
  handleBeautyNoShowScan,
  handleBeautyReactivationScan,
  handleFitnessJourneyTick,
  handleFitnessInactivityScan,
  handleFitnessGraceExpiryScan,
  handleVerticalReconciliation,
  withJobTimeout,
};
