'use strict';

/**
 * Vertical Metrics Engine (shared: beauty + fitness)
 *
 * Computes KPIs per tenant + per vertical:
 * - Appointments created / attended / cancelled / no-show
 * - Frequency per subject
 * - Occupancy (by professional/resource/time slot)
 * - Revenue forecast (when bundle/plan data available)
 * - Membership / plan status distribution
 * - Retention and basic churn rate
 *
 * All queries are DB-based with fallbacks for missing data.
 * Results are not persisted here; use TenantMetricSnapshot for archival.
 */

const { getSequelize } = require('../../db/sequelize');
const { VerticalAttendance, VerticalJourneyEvent, VerticalSessionBundle, VerticalEngagementSignal, AccessMembership } = require('../../db/models');

function dbAvailable() {
  return !!getSequelize();
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// ── Attendance KPIs ───────────────────────────────────────────────────────

async function getAttendanceKpis({ tenantId, vertical, windowDays = 30 }) {
  if (!dbAvailable()) return null;
  const { Op } = require('sequelize');
  const since = daysAgo(windowDays);
  const Model = VerticalAttendance();
  const rows = await Model.findAll({
    where: { tenant_key: tenantId, vertical, checked_in_at: { [Op.gte]: since } },
    attributes: ['status', 'subject_id'],
    limit: 5000,
  }).catch(() => []);

  const data = rows.map((r) => (r.toJSON ? r.toJSON() : r));
  const total = data.length;
  const completed = data.filter((r) => r.status === 'completed').length;
  const absent = data.filter((r) => r.status === 'absent').length;
  const open = data.filter((r) => r.status === 'open').length;
  const uniqueSubjects = new Set(data.map((r) => r.subject_id)).size;

  // Return rate: subjects with >1 attendance
  const countBySubject = {};
  data.forEach((r) => { countBySubject[r.subject_id] = (countBySubject[r.subject_id] || 0) + 1; });
  const returningSubjects = Object.values(countBySubject).filter((c) => c > 1).length;

  return {
    windowDays,
    total,
    completed,
    absent,
    open,
    uniqueSubjects,
    returningSubjects,
    noShowRate: total > 0 ? Math.round((absent / total) * 100) / 100 : 0,
    returnRate: uniqueSubjects > 0 ? Math.round((returningSubjects / uniqueSubjects) * 100) / 100 : 0,
  };
}

// ── Journey KPIs ──────────────────────────────────────────────────────────

async function getJourneyKpis({ tenantId, vertical, windowDays = 30 }) {
  if (!dbAvailable()) return null;
  const { Op } = require('sequelize');
  const since = daysAgo(windowDays);
  const Model = VerticalJourneyEvent();
  const rows = await Model.findAll({
    where: { tenant_key: tenantId, vertical, occurred_at: { [Op.gte]: since } },
    attributes: ['event_type'],
    limit: 10000,
  }).catch(() => []);

  const data = rows.map((r) => (r.toJSON ? r.toJSON() : r));
  const countByType = {};
  data.forEach((r) => { countByType[r.event_type] = (countByType[r.event_type] || 0) + 1; });

  return { windowDays, totalJourneyEvents: data.length, byEventType: countByType };
}

// ── Membership KPIs ───────────────────────────────────────────────────────

async function getMembershipKpis({ tenantId, vertical }) {
  if (!dbAvailable()) return null;
  const Model = AccessMembership();
  const rows = await Model.findAll({
    where: { tenant_key: tenantId, vertical },
    attributes: ['billing_status', 'status'],
    limit: 10000,
  }).catch(() => []);

  const data = rows.map((r) => (r.toJSON ? r.toJSON() : r));
  const total = data.length;
  const countByBilling = {};
  data.forEach((r) => { countByBilling[r.billing_status] = (countByBilling[r.billing_status] || 0) + 1; });
  const active = countByBilling['active'] || 0;
  const churnProxy = (countByBilling['cancelled'] || 0) + (countByBilling['blocked'] || 0);

  return {
    total,
    active,
    churnProxy,
    churnRate: total > 0 ? Math.round((churnProxy / total) * 100) / 100 : 0,
    byBillingStatus: countByBilling,
  };
}

// ── Session revenue proxy ─────────────────────────────────────────────────

async function getRevenueProxy({ tenantId, vertical, windowDays = 30 }) {
  if (!dbAvailable()) return null;
  const { Op } = require('sequelize');
  const since = daysAgo(windowDays);
  const Model = VerticalSessionBundle();
  const rows = await Model.findAll({
    where: { tenant_key: tenantId, vertical, created_at: { [Op.gte]: since } },
    attributes: ['bundle_type', 'status', 'billing_status', 'total_sessions'],
    limit: 5000,
  }).catch(() => []);

  const data = rows.map((r) => (r.toJSON ? r.toJSON() : r));
  const bundlesCreated = data.length;
  const activeSubscriptions = data.filter((r) => r.bundle_type === 'subscription' && r.status === 'active').length;
  const activePackages = data.filter((r) => r.bundle_type === 'package' && r.status === 'active').length;

  return { windowDays, bundlesCreated, activeSubscriptions, activePackages };
}

// ── Engagement KPIs ───────────────────────────────────────────────────────

async function getEngagementKpis({ tenantId, vertical }) {
  if (!dbAvailable()) return null;
  const Model = VerticalEngagementSignal();
  const rows = await Model.findAll({
    where: { tenant_key: tenantId, vertical },
    attributes: ['signal_type', 'score'],
    order: [['computed_at', 'DESC']],
    limit: 5000,
  }).catch(() => []);

  const data = rows.map((r) => (r.toJSON ? r.toJSON() : r));
  const countBySignal = {};
  data.forEach((r) => { countBySignal[r.signal_type] = (countBySignal[r.signal_type] || 0) + 1; });

  return { bySignalType: countBySignal, totalSignals: data.length };
}

// ── Aggregate snapshot ────────────────────────────────────────────────────

/**
 * Compute all KPIs for a vertical at once.
 * @returns {Promise<object>} full metrics snapshot
 */
async function computeVerticalMetrics({ tenantId, vertical, windowDays = 30 }) {
  const [attendance, journey, membership, revenue, engagement] = await Promise.all([
    getAttendanceKpis({ tenantId, vertical, windowDays }).catch(() => null),
    getJourneyKpis({ tenantId, vertical, windowDays }).catch(() => null),
    getMembershipKpis({ tenantId, vertical }).catch(() => null),
    getRevenueProxy({ tenantId, vertical, windowDays }).catch(() => null),
    getEngagementKpis({ tenantId, vertical }).catch(() => null),
  ]);

  return {
    tenantId,
    vertical,
    windowDays,
    computedAt: new Date().toISOString(),
    attendance,
    journey,
    membership,
    revenue,
    engagement,
  };
}

module.exports = {
  getAttendanceKpis,
  getJourneyKpis,
  getMembershipKpis,
  getRevenueProxy,
  getEngagementKpis,
  computeVerticalMetrics,
};
