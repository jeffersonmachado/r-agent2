'use strict';

/**
 * Engagement Engine (shared: beauty + fitness)
 *
 * Detects:
 * - Low frequency (visited less than threshold in past 30 days)
 * - Inactivity (no visit in N days)
 * - No-show risk (beauty: correlates schedule confirmations vs actual attendance)
 * - Churn risk (fitness: inactivity + delinquency signals)
 * - Reactivation candidates
 *
 * Writes signals to vertical_engagement_signals for operational use.
 * REQUIRES AI/ML provider. No heuristic fallback.
 */

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const { VerticalAttendance, VerticalEngagementSignal } = require('../../db/models');
const { appendEventV1 } = require('../eventLedgerService');
const logger = require('../../utils/logger');

// ── defaults (overridable by tenant metadata later) ──────────────────────
const DEFAULTS = {
  fitness: {
    low_frequency_threshold: 2,    // visits per 30 days below this → low_frequency
    inactive_days_threshold: 14,   // not visited for N days → inactive
    churn_risk_days: 30,           // no visit for N days + delinquent → high churn
  },
  beauty: {
    low_frequency_threshold: 1,    // appointments per 60 days
    inactive_days_threshold: 60,
    no_show_history_window: 90,    // days of history for no-show rate calculation
  },
  clinic: {
    low_frequency_threshold: 1,    // consultations per 60 days
    inactive_days_threshold: 150,  // no consultation for N days → recall due
    no_show_history_window: 90,    // days of history for no-show rate calculation
  },
};

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function dbAvailable() {
  return !!getSequelize();
}

// ── Attendance helpers ────────────────────────────────────────────────────

async function getRecentAttendances({ tenantId, vertical, subjectId, windowDays = 30 }) {
  if (!dbAvailable()) return [];
  const { Op } = require('sequelize');
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const Model = VerticalAttendance();
  const rows = await Model.findAll({
    where: {
      tenant_key: tenantId,
      vertical,
      subject_id: String(subjectId),
      checked_in_at: { [Op.gte]: since },
    },
    order: [['checked_in_at', 'DESC']],
    limit: 200,
  }).catch(() => []);
  return rows.map((r) => (r.toJSON ? r.toJSON() : r));
}

// ── Score computation ─────────────────────────────────────────────────────

/**
 * REQUIRES trained ML model (logistic regression, per tenant). No heuristic
 * fallback — fail-closed via churnModelService.scoreFitnessChurn, que lança
 * AI_ML_REQUIRED quando não existe modelo treinado do tenant.
 */
async function computeFitnessChurnScore({ tenantId, daysSinceLastVisit, frequency30d, billingStatus }) {
  // Lazy require: evita ciclo vertical ↔ vertical.
  // eslint-disable-next-line global-require
  const { scoreFitnessChurn } = require('./churnModelService');
  const result = await scoreFitnessChurn({ tenantId, daysSinceLastVisit, frequency30d, billingStatus });
  return result.score;
}

/**
 * REQUIRES AI/ML provider. No heuristic fallback.
 * Throws with clear error message when AI is unavailable.
 */
function computeBeautyNoShowScore({ noShowCount, totalAppointments, daysSinceLastVisit }) {
  throw new Error('AI_ML_REQUIRED: computeBeautyNoShowScore requires AI/ML provider. Heuristic fallback removed. Provide real ML model integration.');
}

// ── Main signal computation ───────────────────────────────────────────────

/**
 * Compute and persist engagement signal for a subject.
 *
 * @param {object} p
 * @param {string}  p.tenantId
 * @param {string}  p.vertical        'beauty'|'fitness'
 * @param {string}  p.subjectId       AccessSubject.id
 * @param {string}  [p.membershipId]
 * @param {string}  [p.billingStatus] current billing_status of the membership
 * @param {number}  [p.noShowCount]   beauty only
 * @param {number}  [p.totalAppointments] beauty only
 * @returns {Promise<object>}  the engagement signal record
 */
async function computeEngagementSignal({ tenantId, vertical, subjectId, membershipId = null, billingStatus = 'active', noShowCount = 0, totalAppointments = 0 }) {
  // Fetch recent attendance
  const windowDays = vertical === 'beauty' ? 60 : 30;
  const recent = await getRecentAttendances({ tenantId, vertical, subjectId, windowDays });
  const frequency30d = recent.filter((a) => {
    const diff = Date.now() - new Date(a.checked_in_at || a.created_at).getTime();
    return diff <= 30 * 24 * 60 * 60 * 1000;
  }).length;

  let lastAttendance = recent[0] || null;
  if (!lastAttendance && dbAvailable()) {
    // Fora da janela recente: busca a última presença real sem limite de
    // janela — sem isso, quem mais precisa de recuperação (30+ dias sem
    // vir) apareceria com o sentinela 999 em vez dos dias reais.
    const Model = VerticalAttendance();
    const row = await Model.findOne({
      where: { tenant_key: tenantId, vertical, subject_id: String(subjectId) },
      order: [['checked_in_at', 'DESC']],
    }).catch(() => null);
    lastAttendance = row ? (row.toJSON ? row.toJSON() : row) : null;
  }
  const lastAt = lastAttendance ? new Date(lastAttendance.checked_in_at || lastAttendance.created_at) : null;
  const daysSinceLastVisit = lastAt ? Math.floor((Date.now() - lastAt.getTime()) / 86400000) : 999;

  let signalType;
  let score;
  let computedBy = 'ai_ml_required';

  if (vertical === 'fitness') {
    // ML real: regressão logística treinada por tenant (churnModelService).
    // Lança AI_ML_REQUIRED quando não há modelo treinado — fail-closed.
    // eslint-disable-next-line global-require
    const { scoreFitnessChurn } = require('./churnModelService');
    const scored = await scoreFitnessChurn({ tenantId, daysSinceLastVisit, frequency30d, billingStatus });
    score = scored.score;
    computedBy = `ml_logreg:v${scored.modelVersion}`;
    if (score >= 0.6) signalType = 'churn_risk';
    else if (frequency30d < DEFAULTS.fitness.low_frequency_threshold) signalType = 'low_frequency';
    else if (daysSinceLastVisit >= DEFAULTS.fitness.inactive_days_threshold) signalType = 'inactive';
    else signalType = 'healthy';
  } else {
    score = computeBeautyNoShowScore({ noShowCount, totalAppointments, daysSinceLastVisit });
    const verticalDefaults = DEFAULTS[vertical] || DEFAULTS.beauty;
    if (score >= 0.6) signalType = 'no_show_risk';
    else if (daysSinceLastVisit >= verticalDefaults.inactive_days_threshold) signalType = 'inactive';
    else signalType = 'healthy';
  }

  const signalRow = {
    tenant_key: tenantId,
    vertical,
    subject_id: subjectId,
    membership_id: membershipId,
    signal_type: signalType,
    score,
    last_attendance_at: lastAt,
    days_since_last_visit: daysSinceLastVisit,
    frequency_last_30d: frequency30d,
    metadata: { billingStatus, noShowCount, totalAppointments, computed_by: computedBy },
    computed_at: new Date(),
  };

  if (dbAvailable()) {
    const Model = VerticalEngagementSignal();
    const id = makeId('ves');
    const row = await Model.create({ id, ...signalRow }).catch(async (err) => {
      // on error – best effort, return in-memory object
      logger.warn('[EngagementEngine] failed to persist signal', { error: err?.message });
      return { id, ...signalRow };
    });
    signalRow.id = row.id || id;
  }

  // Emit ledger event (best-effort)
  await appendEventV1({
    tenantId,
    type: 'VerticalEngagementSignalComputed',
    source: `vertical.engagement.${vertical}`,
    occurredAt: new Date(),
    correlationId: subjectId,
    subject: { type: vertical === 'beauty' ? 'beauty_customer' : 'fitness_subject', id: subjectId },
    actor: { type: 'system', id: 'engagement_engine' },
    payload: { signalType, score, daysSinceLastVisit, frequency30d },
  }).catch(() => {});

  return signalRow;
}

/**
 * List latest engagement signals for a tenant (operational view).
 */
async function listEngagementSignals({ tenantId, vertical, signalType, limit = 50 } = {}) {
  if (!dbAvailable()) return { items: [], total: 0 };
  const Model = VerticalEngagementSignal();
  const where = { tenant_key: tenantId };
  if (vertical) where.vertical = vertical;
  if (signalType) where.signal_type = signalType;

  const cap = Math.min(Number(limit) || 50, 500);
  const rows = await Model.findAll({
    where,
    order: [['computed_at', 'DESC']],
    limit: cap,
  }).catch(() => []);

  return {
    items: rows.map((r) => (r.toJSON ? r.toJSON() : r)),
    total: rows.length,
  };
}

module.exports = {
  DEFAULTS,
  computeFitnessChurnScore,
  computeBeautyNoShowScore,
  computeEngagementSignal,
  listEngagementSignals,
  getRecentAttendances,
};
