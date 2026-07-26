'use strict';

/**
 * Fitness Attendance Service
 *
 * Correlates AccessDecision events with VerticalAttendance records:
 * - Entry validated → creates/opens attendance record
 * - Exit event → closes attendance record (duration computed)
 * - Attendance is traceable by tenant, subject, membership, device and unit
 * - Provides frequency queries for analytics and engagement engine
 *
 * Keeps separation between access control decision and analytic presence.
 */

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const { VerticalAttendance } = require('../../db/models');
const { appendEventV1 } = require('../eventLedgerService');
const { emitJourneyEvent } = require('./customerJourneyEngine');
const logger = require('../../utils/logger');

const VERTICAL = 'fitness';

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function dbAvailable() {
  return !!getSequelize();
}

/**
 * Projeta a presença na timeline operacional do subject
 * (/api/fitness/subject/:id/timeline). Best-effort: a attendance já está
 * persistida e a catraca não pode ser bloqueada por falha na projeção,
 * mas o erro é sempre logado (nunca engolido silenciosamente).
 */
async function emitAttendanceJourneyEvent(params) {
  try {
    await emitJourneyEvent(params);
  } catch (error) {
    logger.error('[FitnessAttendance] Falha ao emitir evento de timeline', {
      eventType: params.eventType,
      subjectId: params.subjectId,
      error: error && error.message ? error.message : String(error),
    });
  }
}

// ── Check-in (entry) ──────────────────────────────────────────────────────

/**
 * Record check-in for a subject. Called when an `allow` AccessDecision is issued
 * for the fitness vertical.
 *
 * @param {object} params
 * @param {string}  params.tenantId
 * @param {string}  params.subjectId
 * @param {string}  [params.membershipId]
 * @param {string}  [params.accessDecisionId]  AccessDecision.id for correlation
 * @param {string}  [params.unitId]
 * @param {string}  [params.deviceId]
 * @returns {Promise<object>} attendance record
 */
async function recordCheckIn({ tenantId, subjectId, membershipId = null, accessDecisionId = null, unitId = null, deviceId = null, metadata = {} }) {
  const id = makeId('va');
  const now = new Date();

  let row = { id, tenant_key: tenantId, vertical: VERTICAL, subject_id: subjectId, membership_id: membershipId, access_decision_id: accessDecisionId, unit_id: unitId, device_id: deviceId, checked_in_at: now, status: 'open', metadata };

  if (dbAvailable()) {
    const Model = VerticalAttendance();

    // Duplicate check-in prevention: if subject already has an open attendance, return it
    const existingOpen = await Model.findOne({
      where: { tenant_key: tenantId, vertical: VERTICAL, subject_id: String(subjectId), status: 'open' },
      order: [['checked_in_at', 'DESC']],
    }).catch(() => null);
    if (existingOpen) {
      return existingOpen.toJSON ? existingOpen.toJSON() : existingOpen;
    }

    const created = await Model.create(row);
    row = created.toJSON ? created.toJSON() : created;
  }

  // Emit ledger event (best-effort)
  await appendEventV1({
    tenantId,
    type: 'FitnessCheckIn',
    source: 'vertical.attendance.fitness',
    occurredAt: now,
    correlationId: accessDecisionId || id,
    subject: { type: 'fitness_subject', id: subjectId },
    actor: { type: 'system', id: deviceId || 'attendance' },
    idempotencyKey: accessDecisionId ? `checkin:${accessDecisionId}` : null,
    payload: { attendanceId: id, subjectId, membershipId, unitId, deviceId },
  }).catch(() => {});

  // Projeta na timeline operacional do subject (best-effort, erro logado)
  await emitAttendanceJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'checkin_recorded',
    subjectId,
    membershipId,
    channel: 'internal',
    triggeredBy: 'event',
    correlationId: accessDecisionId || id,
    idempotencyKey: accessDecisionId ? `checkin:${accessDecisionId}` : `checkin:${id}`,
    payload: { attendanceId: id, subjectId, membershipId, unitId, deviceId },
    metadata: { auto: metadata.auto === true },
  });

  return row;
}

// ── Check-out (exit) ──────────────────────────────────────────────────────

/**
 * Record check-out (close open attendance).
 * Computes duration and emits ledger event.
 */
async function recordCheckOut({ tenantId, subjectId, accessDecisionId = null, attendanceId = null, deviceId = null, metadata = {} }) {
  if (!dbAvailable()) return null;

  const { Op } = require('sequelize');
  const Model = VerticalAttendance();

  // Resolve which attendance record to close
  const where = { tenant_key: tenantId, subject_id: String(subjectId), status: 'open', vertical: VERTICAL };
  if (attendanceId) where.id = attendanceId;
  else if (accessDecisionId) where.access_decision_id = accessDecisionId;

  const row = await Model.findOne({ where, order: [['checked_in_at', 'DESC']] }).catch(() => null);
  if (!row) return null;

  const now = new Date();
  const checkedIn = new Date(row.checked_in_at);
  const durationMinutes = Math.round((now - checkedIn) / 60000);

  await row.update({ checked_out_at: now, duration_minutes: durationMinutes, status: 'completed', metadata: { ...row.metadata, ...metadata } });
  const updated = row.toJSON ? row.toJSON() : row;

  await appendEventV1({
    tenantId,
    type: 'FitnessCheckOut',
    source: 'vertical.attendance.fitness',
    occurredAt: now,
    correlationId: updated.access_decision_id || updated.id,
    subject: { type: 'fitness_subject', id: subjectId },
    actor: { type: 'system', id: deviceId || 'attendance' },
    idempotencyKey: updated.id ? `checkout:${updated.id}` : null,
    payload: { attendanceId: updated.id, durationMinutes, subjectId },
  }).catch(() => {});

  // Projeta na timeline operacional do subject (best-effort, erro logado)
  await emitAttendanceJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'checkout_recorded',
    subjectId,
    membershipId: updated.membership_id || null,
    channel: 'internal',
    triggeredBy: 'event',
    correlationId: updated.access_decision_id || updated.id,
    idempotencyKey: accessDecisionId
      ? `checkout:${accessDecisionId}`
      : (updated.id ? `checkout:${updated.id}` : null),
    payload: { attendanceId: updated.id, durationMinutes, subjectId },
    metadata: { auto: metadata.auto === true },
  });

  return updated;
}

// ── Mark no-show ──────────────────────────────────────────────────────────

async function markAbsent({ tenantId, attendanceId, subjectId, metadata = {} }) {
  if (!dbAvailable()) return null;
  const Model = VerticalAttendance();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: String(attendanceId) } }).catch(() => null);
  if (!row) return null;
  await row.update({ status: 'absent', metadata: { ...row.metadata, ...metadata } });
  return row.toJSON ? row.toJSON() : row;
}

// ── Queries ───────────────────────────────────────────────────────────────

/**
 * Get attendance history + frequency summary for a subject.
 */
async function getAttendanceHistory({ tenantId, subjectId, windowDays = 90, limit = 100 }) {
  if (!dbAvailable()) return { items: [], total: 0, frequency30d: 0, frequency7d: 0 };
  const { Op } = require('sequelize');
  const since = new Date(Date.now() - windowDays * 86400000);
  const Model = VerticalAttendance();
  const rows = await Model.findAll({
    where: {
      tenant_key: tenantId,
      vertical: VERTICAL,
      subject_id: String(subjectId),
      checked_in_at: { [Op.gte]: since },
    },
    order: [['checked_in_at', 'DESC']],
    limit: Math.min(Number(limit) || 100, 500),
  }).catch(() => []);

  const items = rows.map((r) => (r.toJSON ? r.toJSON() : r));
  const now = Date.now();
  const d30 = now - 30 * 86400000;
  const d7 = now - 7 * 86400000;
  const frequency30d = items.filter((a) => new Date(a.checked_in_at).getTime() >= d30).length;
  const frequency7d = items.filter((a) => new Date(a.checked_in_at).getTime() >= d7).length;

  return { items, total: items.length, frequency30d, frequency7d };
}

/**
 * List all open attendances for a tenant (operational view for operators).
 */
async function listOpenAttendances({ tenantId, unitId, limit = 50 }) {
  if (!dbAvailable()) return { items: [], total: 0 };
  const where = { tenant_key: tenantId, vertical: VERTICAL, status: 'open' };
  if (unitId) where.unit_id = unitId;
  const Model = VerticalAttendance();
  const rows = await Model.findAll({
    where,
    order: [['checked_in_at', 'ASC']],
    limit: Math.min(Number(limit) || 50, 200),
  }).catch(() => []);
  const items = rows.map((r) => (r.toJSON ? r.toJSON() : r));
  return { items, total: items.length };
}

// ── Auto-close stale open attendances ─────────────────────────────────────

/**
 * Close all open attendances older than maxOpenHours for a tenant.
 * Assigns status = 'absent' and computes duration.
 * Called by the scheduler to handle missed check-outs.
 */
async function closeStaleOpenAttendances({ tenantId, maxOpenHours = 8 }) {
  if (!dbAvailable()) return { closed: 0 };
  const { Op } = require('sequelize');
  const staleThreshold = new Date(Date.now() - maxOpenHours * 3600000);
  const Model = VerticalAttendance();
  const stale = await Model.findAll({
    where: {
      tenant_key: tenantId,
      vertical: VERTICAL,
      status: 'open',
      checked_in_at: { [Op.lt]: staleThreshold },
    },
    limit: 100,
  }).catch(() => []);

  let closed = 0;
  for (const row of stale) {
    const now = new Date();
    const checkedIn = new Date(row.checked_in_at);
    const durationMinutes = Math.round((now - checkedIn) / 60000);
    await row.update({ status: 'absent', checked_out_at: now, duration_minutes: durationMinutes, metadata: { ...row.metadata, auto_closed: true } }).catch(() => {});
    closed++;
  }
  return { closed };
}

module.exports = {
  recordCheckIn,
  recordCheckOut,
  markAbsent,
  getAttendanceHistory,
  listOpenAttendances,
  closeStaleOpenAttendances,
};
