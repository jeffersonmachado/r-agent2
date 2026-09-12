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
 *   - vertical_clinic_journey_tick
 *   - vertical_clinic_noshow_scan
 *   - vertical_clinic_recall_scan
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
const { VerticalJourneyEvent, VerticalAttendance, AccessMembership, Order } = require('../../db/models');
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

/**
 * Orçamento de tempo de um tick vertical.
 *
 * Incidente operacional (2026-09-11): cada `vertical_*_journey_tick` percorria
 * centenas de assuntos com várias escritas/eventos cada (fitness: até 500
 * memberships × scoring ML + insert + appendEvent) e estourava o timeout de
 * 30s. O job ia para retry, o handler abandonado continuava rodando e o tick
 * nunca avançava: a fila acumulou ~280k pendências, o Postgres saturou e o
 * login da API passou a estourar timeout.
 *
 * Com o orçamento o tick SEMPRE conclui dentro do timeout e progride um lote
 * por execução (o scheduler reenfileira a cada minuto), sem retry nem trabalho
 * abandonado. O valor default fica abaixo de `VERTICAL_JOB_TIMEOUT_MS` para
 * sobrar folga para o fechamento do tick.
 */
const TICK_BUDGET_MS = Number(process.env.VERTICAL_TICK_BUDGET_MS) || Math.floor(JOB_TIMEOUT_MS * 0.7);

function createTickBudget(budgetMs = null) {
  const ms = Number(budgetMs) > 0 ? Number(budgetMs) : TICK_BUDGET_MS;
  const startedAt = Date.now();
  return {
    ms,
    startedAt,
    elapsedMs: () => Date.now() - startedAt,
    expired: () => Date.now() - startedAt >= ms,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// BEAUTY HANDLERS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Main beauty tick: scan for scheduled journeys that need automation.
 * payload: { tenantId, windowHours? }
 */
async function handleBeautyJourneyTick(job, budget = null) {
  const tenantId = safeStr(job?.payload?.tenantId || job?.tenant_key || '');
  if (!tenantId || !dbAvailable()) return;

  const tickBudget = budget || createTickBudget();
  const windowHours = Number(job?.payload?.windowHours) || 26; // scan next 26 h
  const beauty = getBeautyService();

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
      if (hoursUntil > 0 && hoursUntil <= 1.5) {
        // Near-time: send 1h reminder
        const existing1h = await VerticalJourneyEvent().findOne({
          where: { tenant_key: tenantId, vertical: 'beauty', event_type: 'reminder_1h', schedule_id: scheduleId },
        }).catch(() => null);
        if (!existing1h) {
          try {
            await beauty.sendReminderNearTime({
              tenantId,
              subjectId,
              customerId,
              scheduleId,
              channel: row.channel || 'whatsapp',
              metadata: { scheduleId, scheduledAt, channel: row.channel || 'whatsapp' },
            });
          } catch (err) {
            logger.warn('[VerticalJourney] beauty reminder_1h failed', { tenantId, scheduleId, error: err?.message });
          }
        }
      } else if (hoursUntil > 0 && hoursUntil <= windowHours) {
        // Send 24h reminder
        try {
          await beauty.sendReminder24h({
            tenantId,
            subjectId,
            customerId,
            scheduleId,
            channel: row.channel || 'whatsapp',
            metadata: { scheduleId, scheduledAt, channel: row.channel || 'whatsapp' },
          });
          logger.info('[VerticalJourney] beauty reminder_24h sent', { tenantId, scheduleId });
        } catch (err) {
          logger.warn('[VerticalJourney] beauty reminder_24h failed', { tenantId, scheduleId, error: err?.message });
        }
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] beauty tick reminders error', { tenantId, error: err?.message });
  }

  // ── 2. No-show scan: appointments that passed with no service_completed ─
  if (!tickBudget.expired()) {
    await handleBeautyNoShowScan({ tenantId }, tickBudget);
  }
}

/**
 * Scan for beauty no-shows: confirmation_sent > 2h ago, no service_completed.
 */
async function handleBeautyNoShowScan({ tenantId, payload } = {}, budget = null) {
  const tid = safeStr(tenantId || payload?.tenantId || '');
  if (!tid || !dbAvailable()) return;
  const tickBudget = budget || createTickBudget();
  const beauty = getBeautyService();

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
      if (tickBudget.expired()) break;
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
          metadata: { triggeredBy: 'scheduler', source: 'no_show_scan', channel: 'whatsapp' },
        });
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
async function handleBeautyReactivationScan({ tenantId: tid, payload } = {}, budget = null) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;
  const tickBudget = budget || createTickBudget();
  const beauty = getBeautyService();

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
      if (tickBudget.expired()) break;
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
          channel: 'whatsapp',
          metadata: { triggeredBy: 'scheduler', source: 'reactivation_scan' },
        });
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
async function handleFitnessJourneyTick(job, budget = null) {
  const tenantId = safeStr(job?.payload?.tenantId || job?.tenant_key || '');
  if (!tenantId || !dbAvailable()) return;

  const tickBudget = budget || createTickBudget();

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

  // Cada etapa checa o orçamento: o tick precisa terminar (e não ser
  // abandonado pelo timeout) para o scheduler seguir avançando.
  await handleFitnessInactivityScan({ tenantId }, tickBudget);
  if (!tickBudget.expired()) {
    await handleFitnessGraceExpiryScan({ tenantId }, tickBudget);
  }
  // Retreino ML é a etapa mais cara: só roda com orçamento sobrando.
  if (!tickBudget.expired()) {
    await handleFitnessChurnModelRetrain({ tenantId });
  } else {
    logger.info('[VerticalJourney] fitness tick truncado por orçamento (retreino adiado)', {
      tenantId,
      elapsedMs: tickBudget.elapsedMs(),
    });
  }
}

/**
 * Trigger pós-loop: retreina o modelo de churn (ML) depois que a jornada
 * processou presenças e sinais. NÃO é agendador — dispara como etapa final
 * do próprio tick fitness, com throttle para não retreinar a cada tick.
 *
 * Fail-soft por desenho: tenant sem massa mínima (INSUFFICIENT_TRAINING_DATA)
 * ou com erro de treino apenas registra log — o loop nunca quebra por causa
 * do ML. Sem modelo treinado, o scoring segue fail-closed (AI_ML_REQUIRED).
 */
const RETRAIN_MIN_INTERVAL_HOURS = Number(process.env.VERTICAL_CHURN_RETRAIN_INTERVAL_HOURS) || 24;

async function handleFitnessChurnModelRetrain({ tenantId: tid, payload } = {}) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return { retrained: false, reason: 'skipped' };

  try {
    // eslint-disable-next-line global-require
    const churn = require('./churnModelService');
    const active = await churn.getActiveModel({ tenantId });
    if (active?.trained_at) {
      const ageMs = Date.now() - new Date(active.trained_at).getTime();
      if (ageMs < RETRAIN_MIN_INTERVAL_HOURS * 3600e3) {
        return { retrained: false, reason: 'fresh_model', modelVersion: active.version };
      }
    }

    const trained = await churn.trainFitnessChurnModel({ tenantId });
    logger.info('[VerticalJourney] fitness churn model retrained (trigger pós-loop)', {
      tenantId,
      version: trained.version,
      auc: trained.metrics?.auc,
      samples: trained.metrics?.samples,
    });
    return { retrained: true, modelVersion: trained.version };
  } catch (err) {
    if (err?.code === 'INSUFFICIENT_TRAINING_DATA') {
      logger.info('[VerticalJourney] fitness churn retrain skipped (massa insuficiente)', { tenantId });
    } else {
      logger.warn('[VerticalJourney] fitness churn retrain failed', { tenantId, error: err?.message });
    }
    return { retrained: false, reason: err?.code || 'error' };
  }
}

/**
 * Scan for fitness subjects with low frequency / inactivity and dispatch alerts.
 */
async function handleFitnessInactivityScan({ tenantId: tid, payload } = {}, budget = null) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;

  const tickBudget = budget || createTickBudget();
  const fitness = getFitnessService();
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

    let processed = 0;
    let truncated = false;

    for (const m of memberships) {
      // Liveness: o primeiro item sempre é processado. Sem isso, uma carga
      // inicial lenta (requires/cold start) consumiria todo o orçamento e o
      // scan não avançaria nunca.
      if (processed > 0 && tickBudget.expired()) {
        truncated = true;
        break;
      }
      processed += 1;
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
          channel: 'whatsapp',
          correlationId: `churn_${tenantId}_${subjectId}_${Date.now()}`,
          metadata: { signal_type: signal.signal_type, score: signal.score, triggeredBy: 'scheduler' },
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
          channel: 'whatsapp',
          metadata: { frequency30d: signal.frequency_last_30d, triggeredBy: 'scheduler' },
        }).catch(() => {});

        logger.info('[VerticalJourney] fitness frequency_alert sent', { tenantId, subjectId });
      }
    }

    if (truncated) {
      // Observabilidade: o restante volta no próximo tick (1 min).
      logger.info('[VerticalJourney] fitness inactivity scan truncado por orçamento', {
        tenantId,
        processed,
        total: memberships.length,
        elapsedMs: tickBudget.elapsedMs(),
      });
    }
  } catch (err) {
    logger.warn('[VerticalJourney] fitness inactivity scan failed', { tenantId, error: err?.message });
  }
}

/**
 * Scan fitness memberships in grace period whose grace_until has passed → block.
 */
async function handleFitnessGraceExpiryScan({ tenantId: tid, payload } = {}, budget = null) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return { scanned: 0, blocked: 0 };

  const tickBudget = budget || createTickBudget();
  const fitness = getFitnessService();
  let scanned = 0;
  let blocked = 0;

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
    scanned = expired.length;

    for (const m of expired) {
      if (tickBudget.expired()) break;
      const row = m.toJSON ? m.toJSON() : m;
      try {
        await fitness.endGracePeriodWithBlock({ tenantId, membershipId: row.id });
        blocked += 1;
        logger.info('[VerticalJourney] fitness grace_expired → blocked', { tenantId, membershipId: row.id });
      } catch (err) {
        logger.warn('[VerticalJourney] fitness grace expiry block failed', { tenantId, membershipId: row.id, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] fitness grace expiry scan failed', { tenantId, error: err?.message });
  }

  return { scanned, blocked };
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
    const grace = await handleFitnessGraceExpiryScan({ tenantId });
    summary.graceExpired = Number(grace?.blocked || 0);
  } catch (err) {
    summary.errors.push(`grace_expiry: ${err?.message}`);
    logger.warn('[VerticalJourney] reconciliation: grace expiry error', { tenantId, error: err?.message });
  }

  logger.info('[VerticalJourney] reconciliation complete', {
    tenantId,
    action: 'reconciliation',
    result: summary.errors.length === 0 ? 'ok' : 'partial',
    staleAttendancesClosed: summary.staleAttendancesClosed,
    graceExpired: summary.graceExpired,
    errorCount: summary.errors.length,
    durationMs: Date.now() - startMs,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// CLINIC HANDLERS
// ────────────────────────────────────────────────────────────────────────────

function getClinicService() {
  return require('./clinicJourneyService');
}

/**
 * Main clinic tick: reminder dispatch for confirmed consultations + no-show scan.
 * payload: { tenantId, windowHours? }
 */
async function handleClinicJourneyTick(job, budget = null) {
  const tenantId = safeStr(job?.payload?.tenantId || job?.tenant_key || '');
  if (!tenantId || !dbAvailable()) return;

  const tickBudget = budget || createTickBudget();
  const windowHours = Number(job?.payload?.windowHours) || 26; // scan next 26 h
  const clinic = getClinicService();

  // ── 1. Reminders: confirmation_sent events with scheduled_at in window ──
  try {
    const confirmations = await VerticalJourneyEvent().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'clinic',
        event_type: 'confirmation_sent',
        occurred_at: { [Op.gte]: daysAgo(2) },
      },
      limit: 100,
    }).catch(() => []);

    for (const c of confirmations) {
      if (tickBudget.expired()) break;
      const row = c.toJSON ? c.toJSON() : c;
      const scheduleId = row.schedule_id;
      const subjectId = row.subject_id;
      const customerId = row.customer_id;
      if (!scheduleId) continue;

      const scheduledAt = row.payload?.scheduled_at || row.metadata?.scheduled_at;
      if (!scheduledAt) continue;
      const apptMs = new Date(scheduledAt).getTime();
      if (!Number.isFinite(apptMs)) continue;

      const now = Date.now();
      const hoursUntil = (apptMs - now) / 3600000;

      if (hoursUntil > 0 && hoursUntil <= 1.5) {
        const existing1h = await VerticalJourneyEvent().findOne({
          where: { tenant_key: tenantId, vertical: 'clinic', event_type: 'reminder_1h', schedule_id: scheduleId },
        }).catch(() => null);
        if (!existing1h) {
          try {
            await clinic.sendReminderNearTime({
              tenantId,
              subjectId,
              customerId,
              scheduleId,
              channel: row.channel || 'whatsapp',
              metadata: { scheduleId, scheduledAt, channel: row.channel || 'whatsapp' },
            });
          } catch (err) {
            logger.warn('[VerticalJourney] clinic reminder_1h failed', { tenantId, scheduleId, error: err?.message });
          }
        }
      } else if (hoursUntil > 1.5 && hoursUntil <= windowHours) {
        const existing24h = await VerticalJourneyEvent().findOne({
          where: { tenant_key: tenantId, vertical: 'clinic', event_type: 'reminder_24h', schedule_id: scheduleId },
        }).catch(() => null);
        if (existing24h) continue;
        try {
          await clinic.sendReminder24h({
            tenantId,
            subjectId,
            customerId,
            scheduleId,
            channel: row.channel || 'whatsapp',
            metadata: { scheduleId, scheduledAt, channel: row.channel || 'whatsapp' },
          });
          logger.info('[VerticalJourney] clinic reminder_24h sent', { tenantId, scheduleId });
        } catch (err) {
          logger.warn('[VerticalJourney] clinic reminder_24h failed', { tenantId, scheduleId, error: err?.message });
        }
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] clinic tick reminders error', { tenantId, error: err?.message });
  }

  // ── 2. No-show scan ──────────────────────────────────────────────────────
  if (!tickBudget.expired()) {
    await handleClinicNoShowScan({ tenantId }, tickBudget);
  }
}

/**
 * Scan for clinic no-shows: confirmation_sent whose scheduled time passed ≥2h ago
 * with no checkin_recorded / service_completed / no_show_detected.
 */
async function handleClinicNoShowScan({ tenantId, payload } = {}, budget = null) {
  const tid = safeStr(tenantId || payload?.tenantId || '');
  if (!tid || !dbAvailable()) return;
  const tickBudget = budget || createTickBudget();
  const clinic = getClinicService();

  try {
    const candidatesSince = hoursAgo(48);
    const candidatesUntil = hoursAgo(2); // at least 2h past appointment time

    const candidates = await VerticalJourneyEvent().findAll({
      where: {
        tenant_key: tid,
        vertical: 'clinic',
        event_type: 'confirmation_sent',
        occurred_at: { [Op.between]: [candidatesSince, candidatesUntil] },
      },
      limit: 100,
    }).catch(() => []);

    for (const c of candidates) {
      if (tickBudget.expired()) break;
      const row = c.toJSON ? c.toJSON() : c;
      const scheduleId = row.schedule_id;
      if (!scheduleId) continue;

      const scheduledAt = row.payload?.scheduled_at || row.metadata?.scheduled_at;
      if (scheduledAt) {
        const apptMs = new Date(scheduledAt).getTime();
        if (Number.isFinite(apptMs) && apptMs > Date.now() - 2 * 3600000) continue; // not yet 2h past
      }

      const resolved = await VerticalJourneyEvent().findOne({
        where: {
          tenant_key: tid,
          vertical: 'clinic',
          event_type: { [Op.in]: ['checkin_recorded', 'service_completed', 'no_show_detected'] },
          schedule_id: scheduleId,
        },
      }).catch(() => null);
      if (resolved) continue;

      try {
        await clinic.detectNoShow({
          tenantId: tid,
          subjectId: row.subject_id,
          customerId: row.customer_id,
          scheduleId,
          metadata: { triggeredBy: 'scheduler', source: 'no_show_scan', channel: 'whatsapp' },
        });
        logger.info('[VerticalJourney] clinic no_show_detected', { tenantId: tid, scheduleId });
      } catch (err) {
        logger.warn('[VerticalJourney] clinic noshow detect failed', { tenantId: tid, scheduleId, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] clinic no-show scan failed', { tenantId: tid, error: err?.message });
  }
}

/**
 * Clinic recall scan (daily): patients whose last consultation/attendance is
 * older than the recall window (150d default) and who have not received a
 * recall in the last 90 days.
 */
async function handleClinicRecallScan({ tenantId: tid, payload } = {}, budget = null) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;
  const tickBudget = budget || createTickBudget();
  const clinic = getClinicService();

  try {
    const recallWindowDays = Number(payload?.recallWindowDays) || 150;
    const cooldownDays = Number(payload?.cooldownDays) || 90;

    // Patients with attendance older than the recall window
    const oldAttendances = await VerticalAttendance().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'clinic',
        checked_in_at: { [Op.lt]: daysAgo(recallWindowDays) },
      },
      attributes: ['subject_id'],
      group: ['subject_id'],
      limit: 500,
    }).catch(() => []);

    // Patients still active (attendance inside the window)
    const recentAttendances = await VerticalAttendance().findAll({
      where: { tenant_key: tenantId, vertical: 'clinic', checked_in_at: { [Op.gte]: daysAgo(recallWindowDays) } },
      attributes: ['subject_id'],
      limit: 1000,
    }).catch(() => []);
    const recentSubjects = new Set(recentAttendances.map((a) => safeStr((a.toJSON ? a.toJSON() : a).subject_id)));

    const candidates = oldAttendances
      .map((a) => safeStr((a.toJSON ? a.toJSON() : a).subject_id))
      .filter((sid) => sid && !recentSubjects.has(sid));

    for (const subjectId of candidates.slice(0, 50)) {
      if (tickBudget.expired()) break;
      const recentRecall = await VerticalJourneyEvent().findOne({
        where: {
          tenant_key: tenantId,
          vertical: 'clinic',
          event_type: 'return_campaign_sent',
          subject_id: subjectId,
          occurred_at: { [Op.gte]: daysAgo(cooldownDays) },
        },
      }).catch(() => null);
      if (recentRecall) continue;

      try {
        await clinic.sendRecall({
          tenantId,
          subjectId,
          channel: 'whatsapp',
          metadata: { triggeredBy: 'scheduler', recallKey: `${subjectId}:${Math.floor(Date.now() / 86400000)}`, daysWindow: recallWindowDays },
        });
        logger.info('[VerticalJourney] clinic recall sent', { tenantId, subjectId });
      } catch (err) {
        logger.warn('[VerticalJourney] clinic recall failed', { tenantId, subjectId, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] clinic recall scan failed', { tenantId, error: err?.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FOOD HANDLERS
// ────────────────────────────────────────────────────────────────────────────

function getFoodService() {
  return require('./foodJourneyService');
}

/**
 * Food tick: post-delivery review scan.
 * Finds orders delivered in the last 48h whose customer has not received a
 * review request yet, and sends one (idempotent per order).
 * payload: { tenantId }
 */
async function handleFoodJourneyTick(job, budget = null) {
  const tenantId = safeStr(job?.payload?.tenantId || job?.tenant_key || '');
  if (!tenantId || !dbAvailable()) return;
  const tickBudget = budget || createTickBudget();
  const food = getFoodService();

  try {
    const delivered = await Order().findAll({
      where: {
        tenant_key: tenantId,
        status: 'delivered',
        delivered_at: { [Op.gte]: hoursAgo(48) },
      },
      limit: 100,
    }).catch(() => []);

    for (const o of delivered) {
      if (tickBudget.expired()) break;
      const row = o.toJSON ? o.toJSON() : o;
      const octx = row.context && typeof row.context === 'object' ? row.context : {};
      const subjectId = octx.customerSubjectId || null;
      const customerId = octx.customerId || null;
      if (!subjectId && !customerId) continue;

      const existing = await VerticalJourneyEvent().findOne({
        where: {
          tenant_key: tenantId,
          vertical: 'food',
          event_type: 'review_requested',
          idempotency_key: `food_review:${tenantId}:${row.id}`,
        },
      }).catch(() => null);
      if (existing) continue;

      try {
        await food.requestReview({
          tenantId,
          subjectId,
          customerId,
          orderId: row.id,
          orderNumber: row.order_number || null,
          channel: row.source && row.source !== 'internal' ? row.source : 'whatsapp',
          correlationId: octx.correlationId || null,
          metadata: { triggeredBy: 'scheduler', source: 'post_delivery_review_scan' },
        });
        logger.info('[VerticalJourney] food review_requested', { tenantId, orderId: row.id });
      } catch (err) {
        logger.warn('[VerticalJourney] food review request failed', { tenantId, orderId: row.id, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] food tick review scan failed', { tenantId, error: err?.message });
  }
}

/**
 * Food reorder scan (daily): customers whose last delivered order is older
 * than the reorder window (21d default) and who have not received a reorder
 * campaign in the last 14 days.
 */
async function handleFoodReorderScan({ tenantId: tid, payload } = {}, budget = null) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;
  const tickBudget = budget || createTickBudget();
  const food = getFoodService();

  try {
    const reorderWindowDays = Number(payload?.reorderWindowDays) || 21;
    const cooldownDays = Number(payload?.cooldownDays) || 14;

    // Customers with delivered orders — aggregate in memory (capped)
    const delivered = await Order().findAll({
      where: { tenant_key: tenantId, status: 'delivered', delivered_at: { [Op.gte]: daysAgo(180) } },
      attributes: ['id', 'context', 'delivered_at', 'source'],
      order: [['delivered_at', 'DESC']],
      limit: 2000,
    }).catch(() => []);

    // Keep only the most recent delivered order per customer
    const lastByCustomer = new Map();
    for (const o of delivered) {
      const row = o.toJSON ? o.toJSON() : o;
      const octx = row.context && typeof row.context === 'object' ? row.context : {};
      const customerId = octx.customerId || octx.customerSubjectId || null;
      if (!customerId) continue;
      if (!lastByCustomer.has(customerId)) {
        lastByCustomer.set(customerId, {
          customerId,
          subjectId: octx.customerSubjectId || null,
          deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
          channel: row.source && row.source !== 'internal' ? row.source : 'whatsapp',
        });
      }
    }

    const now = Date.now();
    let sent = 0;
    for (const entry of lastByCustomer.values()) {
      if (sent >= 50) break;
      if (tickBudget.expired()) break;
      if (!entry.deliveredAt || !Number.isFinite(entry.deliveredAt.getTime())) continue;
      const daysSince = Math.floor((now - entry.deliveredAt.getTime()) / 86400000);
      if (daysSince < reorderWindowDays) continue; // still active

      const recentCampaign = await VerticalJourneyEvent().findOne({
        where: {
          tenant_key: tenantId,
          vertical: 'food',
          event_type: 'return_campaign_sent',
          customer_id: entry.customerId,
          occurred_at: { [Op.gte]: daysAgo(cooldownDays) },
        },
      }).catch(() => null);
      if (recentCampaign) continue;

      try {
        await food.sendReorderCampaign({
          tenantId,
          subjectId: entry.subjectId,
          customerId: entry.customerId,
          channel: entry.channel,
          metadata: {
            triggeredBy: 'scheduler',
            campaignKey: `${entry.customerId}:${Math.floor(now / 86400000)}`,
            daysSinceLastOrder: daysSince,
          },
        });
        sent += 1;
        logger.info('[VerticalJourney] food reorder campaign sent', { tenantId, customerId: entry.customerId, daysSince });
      } catch (err) {
        logger.warn('[VerticalJourney] food reorder campaign failed', { tenantId, customerId: entry.customerId, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] food reorder scan failed', { tenantId, error: err?.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SERVICES HANDLERS
// ────────────────────────────────────────────────────────────────────────────

function getServicesService() {
  return require('./servicesJourneyService');
}

/**
 * Services tick: quote pipeline automation.
 * 1. Follow-up scan: quote_sent > followUpAfterDays without decision and
 *    without a recent follow-up → sendQuoteFollowUp.
 * 2. Expiry scan: quote_sent > validDays without decision → quote_expired.
 * payload: { tenantId, followUpAfterDays?, defaultValidDays? }
 */
async function handleServicesJourneyTick(job, budget = null) {
  const tenantId = safeStr(job?.payload?.tenantId || job?.tenant_key || '');
  if (!tenantId || !dbAvailable()) return;
  const tickBudget = budget || createTickBudget();
  const services = getServicesService();

  const followUpAfterDays = Number(job?.payload?.followUpAfterDays) || 3;
  const defaultValidDays = Number(job?.payload?.defaultValidDays) || 15;

  try {
    const since = daysAgo(90);
    const [quotes, decisions, recentFollowUps] = await Promise.all([
      VerticalJourneyEvent().findAll({
        where: { tenant_key: tenantId, vertical: 'services', event_type: 'quote_sent', occurred_at: { [Op.gte]: since } },
        limit: 200,
      }).catch(() => []),
      VerticalJourneyEvent().findAll({
        where: { tenant_key: tenantId, vertical: 'services', event_type: { [Op.in]: ['quote_approved', 'quote_declined', 'quote_expired'] }, occurred_at: { [Op.gte]: since } },
        limit: 500,
      }).catch(() => []),
      VerticalJourneyEvent().findAll({
        where: { tenant_key: tenantId, vertical: 'services', event_type: 'quote_follow_up_sent', occurred_at: { [Op.gte]: daysAgo(followUpAfterDays) } },
        limit: 500,
      }).catch(() => []),
    ]);

    const decidedQuotes = new Set(
      decisions.map((d) => (d.toJSON ? d.toJSON() : d).payload?.quoteId).filter(Boolean),
    );
    const followedUpQuotes = new Set(
      recentFollowUps.map((d) => (d.toJSON ? d.toJSON() : d).payload?.quoteId).filter(Boolean),
    );

    for (const raw of quotes) {
      if (tickBudget.expired()) break;
      const row = raw.toJSON ? raw.toJSON() : raw;
      const quoteId = row.payload?.quoteId;
      if (!quoteId) continue;
      if (decidedQuotes.has(quoteId)) continue;

      const sentAt = new Date(row.occurred_at).getTime();
      if (!Number.isFinite(sentAt)) continue;
      const daysSinceSent = (Date.now() - sentAt) / 86400000;
      const validDays = Number(row.payload?.validDays) || defaultValidDays;

      // Expiry first (terminal state)
      if (daysSinceSent >= validDays) {
        try {
          await services.expireQuote({
            tenantId,
            subjectId: row.subject_id,
            customerId: row.customer_id,
            quoteId,
            metadata: { source: 'quote_expiry_scan', validDays },
          });
          logger.info('[VerticalJourney] services quote_expired', { tenantId, quoteId });
        } catch (err) {
          logger.warn('[VerticalJourney] services quote expiry failed', { tenantId, quoteId, error: err?.message });
        }
        continue;
      }

      // Follow-up (max 1 per followUpAfterDays window)
      if (daysSinceSent >= followUpAfterDays && !followedUpQuotes.has(quoteId)) {
        try {
          await services.sendQuoteFollowUp({
            tenantId,
            subjectId: row.subject_id,
            customerId: row.customer_id,
            quoteId,
            sequence: 1,
            channel: row.channel && row.channel !== 'internal' ? row.channel : 'whatsapp',
            metadata: { source: 'quote_followup_scan', daysSinceSent: Math.floor(daysSinceSent) },
          });
          logger.info('[VerticalJourney] services quote_follow_up_sent', { tenantId, quoteId });
        } catch (err) {
          logger.warn('[VerticalJourney] services quote follow-up failed', { tenantId, quoteId, error: err?.message });
        }
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] services tick failed', { tenantId, error: err?.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MARKET HANDLERS
// ────────────────────────────────────────────────────────────────────────────

function getMarketService() {
  return require('./marketJourneyService');
}

/**
 * Market tick (every minute): post-delivery review scan — pedidos entregues
 * nas últimas 48h cujo cliente ainda não recebeu pedido de avaliação.
 */
async function handleMarketJourneyTick(job, budget = null) {
  const tenantId = safeStr(job?.payload?.tenantId || job?.tenant_key || '');
  if (!tenantId || !dbAvailable()) return;
  const tickBudget = budget || createTickBudget();
  const market = getMarketService();

  try {
    const delivered = await Order().findAll({
      where: {
        tenant_key: tenantId,
        status: 'delivered',
        delivered_at: { [Op.gte]: hoursAgo(48) },
      },
      limit: 100,
    }).catch(() => []);

    for (const o of delivered) {
      if (tickBudget.expired()) break;
      const row = o.toJSON ? o.toJSON() : o;
      const octx = row.context && typeof row.context === 'object' ? row.context : {};
      const subjectId = octx.customerSubjectId || null;
      const customerId = octx.customerId || null;
      if (!subjectId && !customerId) continue;

      const existing = await VerticalJourneyEvent().findOne({
        where: {
          tenant_key: tenantId,
          vertical: 'market',
          event_type: 'review_requested',
          idempotency_key: `market_review:${tenantId}:${row.id}`,
        },
      }).catch(() => null);
      if (existing) continue;

      try {
        await market.requestReview({
          tenantId,
          subjectId,
          customerId,
          orderId: row.id,
          orderNumber: row.order_number || null,
          channel: row.source && row.source !== 'internal' ? row.source : 'whatsapp',
          correlationId: octx.correlationId || null,
          metadata: { triggeredBy: 'scheduler', source: 'post_delivery_review_scan' },
        });
        logger.info('[VerticalJourney] market review_requested', { tenantId, orderId: row.id });
      } catch (err) {
        logger.warn('[VerticalJourney] market review request failed', { tenantId, orderId: row.id, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] market tick review scan failed', { tenantId, error: err?.message });
  }
}

/**
 * Market restock/loyalty scan (daily):
 * 1. Restock: última compra entregue ≥ restockWindowDays (30d) sem lembrete
 *    recente (cooldown 14d) → restock_reminder_sent.
 * 2. Win-back: última compra ≥ winBackWindowDays (60d) sem campanha recente
 *    → loyalty_campaign_sent.
 * payload: { tenantId, restockWindowDays?, restockCooldownDays?, winBackWindowDays? }
 */
async function handleMarketRestockScan({ tenantId: tid, payload } = {}, budget = null) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;
  const tickBudget = budget || createTickBudget();
  const market = getMarketService();

  try {
    const restockWindowDays = Number(payload?.restockWindowDays) || 30;
    const restockCooldownDays = Number(payload?.restockCooldownDays) || 14;
    const winBackWindowDays = Number(payload?.winBackWindowDays) || 60;

    const delivered = await Order().findAll({
      where: { tenant_key: tenantId, status: 'delivered', delivered_at: { [Op.gte]: daysAgo(365) } },
      attributes: ['id', 'context', 'delivered_at', 'source'],
      order: [['delivered_at', 'DESC']],
      limit: 2000,
    }).catch(() => []);

    // Compra mais recente por cliente
    const lastByCustomer = new Map();
    for (const o of delivered) {
      const row = o.toJSON ? o.toJSON() : o;
      const octx = row.context && typeof row.context === 'object' ? row.context : {};
      const customerId = octx.customerId || octx.customerSubjectId || null;
      if (!customerId) continue;
      if (!lastByCustomer.has(customerId)) {
        lastByCustomer.set(customerId, {
          customerId,
          subjectId: octx.customerSubjectId || null,
          deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
          channel: row.source && row.source !== 'internal' ? row.source : 'whatsapp',
        });
      }
    }

    const now = Date.now();
    let sent = 0;
    for (const entry of lastByCustomer.values()) {
      if (sent >= 50) break;
      if (tickBudget.expired()) break;
      if (!entry.deliveredAt || !Number.isFinite(entry.deliveredAt.getTime())) continue;
      const daysSince = Math.floor((now - entry.deliveredAt.getTime()) / 86400000);
      if (daysSince < restockWindowDays) continue; // cliente ativo

      const isWinBack = daysSince >= winBackWindowDays;
      const eventType = isWinBack ? 'loyalty_campaign_sent' : 'restock_reminder_sent';
      const recentCampaign = await VerticalJourneyEvent().findOne({
        where: {
          tenant_key: tenantId,
          vertical: 'market',
          event_type: { [Op.in]: ['restock_reminder_sent', 'loyalty_campaign_sent'] },
          customer_id: entry.customerId,
          occurred_at: { [Op.gte]: daysAgo(restockCooldownDays) },
        },
      }).catch(() => null);
      if (recentCampaign) continue;

      const campaignKey = `${entry.customerId}:${Math.floor(now / 86400000)}`;
      try {
        if (isWinBack) {
          await market.sendLoyaltyCampaign({
            tenantId,
            subjectId: entry.subjectId,
            customerId: entry.customerId,
            channel: entry.channel,
            metadata: { triggeredBy: 'scheduler', campaignKey, reason: 'win_back', daysSinceLastPurchase: daysSince },
          });
        } else {
          await market.sendRestockReminder({
            tenantId,
            subjectId: entry.subjectId,
            customerId: entry.customerId,
            channel: entry.channel,
            metadata: { triggeredBy: 'scheduler', campaignKey, daysSinceLastPurchase: daysSince },
          });
        }
        sent += 1;
        logger.info(`[VerticalJourney] market ${eventType}`, { tenantId, customerId: entry.customerId, daysSince });
      } catch (err) {
        logger.warn(`[VerticalJourney] market ${eventType} failed`, { tenantId, customerId: entry.customerId, error: err?.message });
      }
    }
  } catch (err) {
    logger.warn('[VerticalJourney] market restock scan failed', { tenantId, error: err?.message });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// BAKERY HANDLERS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Bakery production plan (daily): retreina modelos de demanda com debounce
 * (24h) e gera o plano do dia seguinte. Produtos sem histórico suficiente
 * ficam insufficient_data (fail-closed, nunca heurística).
 */
async function handleBakeryProductionPlan({ tenantId: tid, payload } = {}) {
  const tenantId = safeStr(tid || payload?.tenantId || '');
  if (!tenantId || !dbAvailable()) return;
  const bakery = require('./bakeryProductionService');

  try {
    const result = await bakery.retrainDemandModels({ tenantId });
    const tomorrow = new Date(Date.now() + 86400000);
    const plan = await bakery.generateProductionPlan({ tenantId, date: tomorrow });
    logger.info('[VerticalJourney] bakery production plan gerado', {
      tenantId,
      trained: result.trained.length,
      skipped: result.skipped.length,
      plannedProducts: plan.items.length,
      withForecast: plan.items.filter((i) => i.status === 'ok').length,
    });
  } catch (err) {
    logger.warn('[VerticalJourney] bakery production plan failed', { tenantId, error: err?.message });
  }
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

  // Orçamento único por execução: garante que o tick conclua dentro do
  // timeout do job (sem retry nem trabalho abandonado rodando em paralelo).
  const tickBudget = createTickBudget();

  logger.info('[VerticalJourney] job start', { tenantId, kind, jobId });

  try {
    switch (kind) {
      case 'vertical_beauty_journey_tick':
        await withJobTimeout(handleBeautyJourneyTick(job, tickBudget), undefined, kind);
        break;

      case 'vertical_beauty_noshow_scan':
        await withJobTimeout(handleBeautyNoShowScan({ tenantId }), undefined, kind);
        break;

      case 'vertical_beauty_reactivation_scan':
        await withJobTimeout(handleBeautyReactivationScan({ tenantId }), undefined, kind);
        break;

      case 'vertical_fitness_journey_tick':
        await withJobTimeout(handleFitnessJourneyTick(job, tickBudget), undefined, kind);
        break;

      case 'vertical_fitness_inactivity_scan':
        await withJobTimeout(handleFitnessInactivityScan({ tenantId }), undefined, kind);
        break;

      case 'vertical_fitness_grace_expiry_scan':
        await withJobTimeout(handleFitnessGraceExpiryScan({ tenantId }), undefined, kind);
        break;

      case 'vertical_clinic_journey_tick':
        await withJobTimeout(handleClinicJourneyTick(job, tickBudget), undefined, kind);
        break;

      case 'vertical_clinic_noshow_scan':
        await withJobTimeout(handleClinicNoShowScan({ tenantId }), undefined, kind);
        break;

      case 'vertical_clinic_recall_scan':
        await withJobTimeout(handleClinicRecallScan({ tenantId, payload: job?.payload }, tickBudget), undefined, kind);
        break;

      case 'vertical_food_journey_tick':
        await withJobTimeout(handleFoodJourneyTick(job, tickBudget), undefined, kind);
        break;

      case 'vertical_food_reorder_scan':
        await withJobTimeout(handleFoodReorderScan({ tenantId, payload: job?.payload }, tickBudget), undefined, kind);
        break;

      case 'vertical_services_journey_tick':
        await withJobTimeout(handleServicesJourneyTick(job, tickBudget), undefined, kind);
        break;

      case 'vertical_market_journey_tick':
        await withJobTimeout(handleMarketJourneyTick(job, tickBudget), undefined, kind);
        break;

      case 'vertical_market_restock_scan':
        await withJobTimeout(handleMarketRestockScan({ tenantId, payload: job?.payload }, tickBudget), undefined, kind);
        break;

      case 'vertical_bakery_production_plan':
        await withJobTimeout(handleBakeryProductionPlan({ tenantId, payload: job?.payload }), undefined, kind);
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
  handleFitnessChurnModelRetrain,
  RETRAIN_MIN_INTERVAL_HOURS,
  handleClinicJourneyTick,
  handleClinicNoShowScan,
  handleClinicRecallScan,
  handleFoodJourneyTick,
  handleFoodReorderScan,
  handleServicesJourneyTick,
  handleMarketJourneyTick,
  handleMarketRestockScan,
  handleBakeryProductionPlan,
  handleVerticalReconciliation,
  withJobTimeout,
  createTickBudget,
  TICK_BUDGET_MS,
};
