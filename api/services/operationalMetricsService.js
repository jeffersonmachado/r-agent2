'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  Tenant,
  Ticket,
  OperationalSchedule,
  OperationalMetricSnapshot,
  OperationalAlert,
  UraDecisionAudit,
  BeautyLoyalty,
  RevenueOpportunity,
  FitnessClassSchedule,
  FitnessAttendance,
  FitnessScheduleResource,
} = require('../db/models');
const beautyService = require('./beautyService');
const fitnessService = require('./fitnessService');

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeStr(value) {
  return String(value == null ? '' : value).trim();
}

function toJson(row) {
  return row?.toJSON ? row.toJSON() : row;
}

function percent(part, total) {
  if (!total) return 0;
  return Number(((Number(part || 0) / Number(total || 1)) * 100).toFixed(2));
}

function avg(items = []) {
  const values = items.map((item) => Number(item)).filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function startOfDay(dateLike = new Date()) {
  const date = new Date(dateLike);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(dateLike = new Date()) {
  const date = startOfDay(dateLike);
  date.setDate(date.getDate() + 1);
  date.setMilliseconds(-1);
  return date;
}

function snapshotDateValue(dateLike = new Date()) {
  return new Date(dateLike).toISOString().slice(0, 10);
}

function occSeverity(value, { warn = 30, danger = 60 } = {}) {
  if (value >= danger) return 'red';
  if (value >= warn) return 'yellow';
  return 'green';
}

async function collectTenantSnapshot({ tenantId, now = new Date() }) {
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const [uraRows, scheduleRows, alertRows, loyaltyRows, opportunityRows, fitnessScheduleRows, attendanceRows, fitnessResourceRows, beautyDashboard, fitnessDashboard, ticketRows] = await Promise.all([
    UraDecisionAudit().findAll({
      where: { tenant_key: String(tenantId), created_at: { [Op.gte]: dayStart, [Op.lte]: dayEnd } },
      order: [['created_at', 'DESC']],
      limit: 500,
    }),
    OperationalSchedule().findAll({
      where: { tenant_key: String(tenantId), start_at: { [Op.gte]: dayStart, [Op.lte]: dayEnd } },
      order: [['start_at', 'DESC']],
      limit: 500,
    }),
    OperationalAlert().findAll({
      where: { tenant_key: String(tenantId), resolved_at: null },
      order: [['created_at', 'DESC']],
      limit: 500,
    }),
    BeautyLoyalty().findAll({ where: { tenant_key: String(tenantId) }, limit: 200 }),
    RevenueOpportunity().findAll({ where: { tenant_key: String(tenantId), status: 'open' }, limit: 200 }),
    FitnessClassSchedule().findAll({
      where: { tenant_key: String(tenantId), start_at: { [Op.gte]: dayStart, [Op.lte]: dayEnd } },
      limit: 500,
    }),
    FitnessAttendance().findAll({ where: { tenant_key: String(tenantId) }, order: [['updated_at', 'DESC']], limit: 500 }),
    FitnessScheduleResource().findAll({ where: { tenant_key: String(tenantId) }, limit: 500 }),
    beautyService.getDashboard({ tenantId }).catch(() => ({ ok: false })),
    fitnessService.getDashboard({ tenantId }).catch(() => ({ ok: false })),
    Ticket().findAll({
      where: { tenant_key: String(tenantId), created_at: { [Op.gte]: dayStart, [Op.lte]: dayEnd } },
      limit: 500,
    }),
  ]);

  const ura = uraRows.map(toJson);
  const schedules = scheduleRows.map(toJson);
  const alerts = alertRows.map(toJson);
  const attendances = attendanceRows.map(toJson);
  const fitnessSchedules = fitnessScheduleRows.map(toJson);
  const tickets = ticketRows.map(toJson);

  const routingByDepartment = ura.reduce((acc, item) => {
    const key = safeStr(item.department_id) || 'unrouted';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const resourceIdsToday = new Set(fitnessSchedules.flatMap((item) => {
    const linked = fitnessResourceRows
      .map(toJson)
      .filter((entry) => safeStr(entry.class_schedule_id) === safeStr(item.id))
      .map((entry) => safeStr(entry.resource_id))
      .filter(Boolean);
    return linked;
  }));

  const canceledSchedules = schedules.filter((item) => safeStr(item.status).toLowerCase() === 'canceled').length;
  const noShowSchedules = schedules.filter((item) => safeStr(item.status).toLowerCase() === 'no_show').length;
  const rescheduledSchedules = schedules.filter((item) => safeStr(item.metadata?.rescheduledFromScheduleId)).length;
  const bookingsToday = (beautyDashboard.ok ? (beautyDashboard.recentSchedules || []).filter((item) => {
    const startAt = item.start_at || item.startAt || null;
    if (!startAt) return false;
    const date = new Date(startAt);
    return date >= dayStart && date <= dayEnd;
  }).length : 0);
  const beautyFreeWindows = beautyDashboard.ok
    ? (beautyDashboard.professionalAgenda || []).reduce((sum, item) => sum + (item.freeWindows || []).length, 0)
    : 0;
  const occupancySource = fitnessDashboard.ok ? (fitnessDashboard.schedules || []) : [];
  const occupancyValues = occupancySource
    .map((item) => Number(item.capacity || 0) > 0 ? percent(item.bookedCount || 0, item.capacity || 1) : null)
    .filter((value) => value != null);

  const payload = {
    generatedAt: new Date(now).toISOString(),
    ura: {
      totalMessages: ura.length,
      classifiedByAi: ura.filter((item) => item.fallback_used !== true).length,
      fallbackCount: ura.filter((item) => item.fallback_used === true).length,
      averageConfidence: avg(ura.map((item) => item.confidence)),
      routingByDepartment,
    },
    scheduling: {
      schedulesToday: schedules.length,
      conflictsDetected: alerts.filter((item) => safeStr(item.alert_type).startsWith('scheduling_')).length,
      noShowRate: percent(noShowSchedules, schedules.length),
      cancelRate: percent(canceledSchedules, schedules.length),
      rescheduleRate: percent(rescheduledSchedules, schedules.length),
    },
    beauty: {
      bookingsToday,
      freeWindowsDetected: beautyFreeWindows,
      loyaltyUsage: loyaltyRows.length,
      reactivationOpportunities: opportunityRows
        .map(toJson)
        .filter((item) => safeStr(item.type) === 'reactivation')
        .length,
    },
    fitness: {
      classesToday: fitnessSchedules.length,
      resourceIdleRate: resourceIdsToday.size > 0
        ? percent((fitnessDashboard.ok ? (fitnessDashboard.idleResources || []).length : 0), resourceIdsToday.size)
        : 0,
      occupancyRate: avg(occupancyValues),
      scheduleConflicts: alerts.filter((item) => safeStr(item.alert_type).includes('conflict')).length,
    },
    ai: {
      classificationRequests: ura.length,
      averageLatency: avg(ura.map((item) => item.latency_ms)),
      providerFailures: ura.filter((item) => ['error', 'timeout'].includes(safeStr(item.provider_status))).length,
      ragUsedRate: percent(ura.filter((item) => item.rag_used === true).length, ura.length),
    },
    support: {
      ticketsToday: tickets.length,
      openTickets: tickets.filter((item) => safeStr(item.status).toLowerCase() !== 'closed').length,
    },
  };

  const fallbackRate = percent(payload.ura.fallbackCount, Math.max(1, payload.ura.totalMessages));
  const schedulingConflictRate = percent(payload.scheduling.conflictsDetected, Math.max(1, payload.scheduling.schedulesToday));
  const health = {
    uraStatus: occSeverity(fallbackRate, { warn: 35, danger: 60 }),
    schedulingStatus: occSeverity(schedulingConflictRate, { warn: 10, danger: 25 }),
    aiStatus: occSeverity(payload.ai.providerFailures, { warn: 3, danger: 8 }),
  };

  return {
    ok: true,
    tenantId: String(tenantId),
    snapshotDate: snapshotDateValue(now),
    hourBucket: new Date(now).getHours(),
    payload: {
      ...payload,
      health,
    },
  };
}

async function storeTenantSnapshot({ tenantId, now = new Date() }) {
  const snapshot = await collectTenantSnapshot({ tenantId, now });
  const where = {
    tenant_key: String(tenantId),
    metric_scope: 'occ',
    snapshot_date: snapshot.snapshotDate,
    vertical_template: 'platform',
    service_type: 'operational_occ',
    owner_id: null,
    team_id: null,
    day_of_week: new Date(now).getDay(),
    hour_bucket: snapshot.hourBucket,
  };
  const existing = await OperationalMetricSnapshot().findOne({ where });
  const payload = {
    ...where,
    open_campaigns: 0,
    filled_campaigns: 0,
    accepted_candidates: 0,
    expired_campaigns: 0,
    fill_rate: 0,
    accept_rate: 0,
    avg_fill_minutes: 0,
    idle_risk_score: null,
    no_show_risk_score: null,
    snapshot_payload_json: snapshot.payload,
  };
  const row = existing
    ? await existing.update(payload)
    : await OperationalMetricSnapshot().create({ id: newId('occsnap'), ...payload });
  return { ok: true, item: toJson(row), snapshot: snapshot.payload };
}

async function listTenantSnapshots({ tenantId, limit = 12 }) {
  const rows = await OperationalMetricSnapshot().findAll({
    where: {
      tenant_key: String(tenantId),
      metric_scope: 'occ',
      vertical_template: 'platform',
      service_type: 'operational_occ',
    },
    order: [['snapshot_date', 'DESC'], ['hour_bucket', 'DESC'], ['created_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 12, 1), 50),
  });
  return { ok: true, items: rows.map(toJson) };
}

async function getLatestTenantSnapshot({ tenantId }) {
  const out = await listTenantSnapshots({ tenantId, limit: 1 });
  return { ok: true, item: out.items[0] || null };
}

async function getTenantsHealthSummary() {
  const tenants = await Tenant().findAll({
    where: { status: { [Op.in]: ['trial', 'active'] } },
    order: [['created_at', 'DESC']],
    limit: 200,
  });
  const items = [];
  for (const row of tenants.map(toJson)) {
    const [snapshotOut, alertsOut] = await Promise.all([
      getLatestTenantSnapshot({ tenantId: row.tenant_key }),
      OperationalAlert().findAll({ where: { tenant_key: String(row.tenant_key), resolved_at: null }, limit: 100 }),
    ]);
    const snapshotPayload = snapshotOut.item?.snapshot_payload_json || null;
    const unresolvedAlerts = alertsOut.map(toJson);
    items.push({
      tenantId: row.tenant_key,
      tenantName: row.name,
      status: row.status,
      latestSnapshotAt: snapshotOut.item?.created_at || snapshotOut.item?.createdAt || null,
      alertsCount: unresolvedAlerts.length,
      uraDegraded: safeStr(snapshotPayload?.health?.uraStatus) === 'red',
      schedulingDegraded: safeStr(snapshotPayload?.health?.schedulingStatus) === 'red',
      aiDegraded: safeStr(snapshotPayload?.health?.aiStatus) === 'red',
      snapshot: snapshotPayload,
    });
  }
  return {
    ok: true,
    summary: {
      tenantsActive: items.length,
      tenantsWithAlerts: items.filter((item) => item.alertsCount > 0).length,
      tenantsWithUraDegraded: items.filter((item) => item.uraDegraded).length,
      tenantsWithSchedulingDegraded: items.filter((item) => item.schedulingDegraded).length,
    },
    items,
  };
}

module.exports = {
  collectTenantSnapshot,
  storeTenantSnapshot,
  listTenantSnapshots,
  getLatestTenantSnapshot,
  getTenantsHealthSummary,
};
