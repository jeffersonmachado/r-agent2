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
const { computeInsightsPayload } = require('./operations/operationsDashboardInsights');
const { computeDashboardSummary } = require('./operations/operationsDashboardSummary');
const { listDashboardNotifications } = require('./operations/operationsDashboardNotificationsListing');
const { listDashboardJobs } = require('./operations/operationsDashboardJobsListing');
const { listDashboardTimeline } = require('./operations/operationsDashboardTimelineListing');
const {
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
  applyPagination,
  ensureTenant,
  isNotificationJourneyEventType,
} = require('./operations/operationsDashboardHelpers');

function dbAvailable() {
  return !!getSequelize();
}

async function computeSummary({ tenantId, vertical = 'all', startDate, endDate }) {
  const tid = ensureTenant(tenantId);
  const selectedVertical = normalizeVertical(vertical);
  const period = normalizePeriod({ startDate, endDate, defaultWindowDays: 30 });
  return computeDashboardSummary(
    {
      tenantId: tid,
      selectedVertical,
      period,
    },
    {
      dbAvailable,
      Op,
      models: {
        VerticalJourneyEvent,
        VerticalAttendance,
        VerticalEngagementSignal,
        AccessMembership,
        ExecutionJob,
        EventLedger,
      },
      computeVerticalMetrics,
      safeString,
      safeDate,
      startOfDay,
      endOfDay,
      normalizeNotificationStatus,
    },
  );
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
  return listDashboardTimeline(
    {
      tenantId: tid,
      selectedVertical,
      selectedStatus,
      subjectId,
      customerId,
      membershipId,
      safePage,
      safeLimit,
      period,
    },
    {
      dbAvailable,
      Op,
      models: {
        VerticalJourneyEvent,
        VerticalAttendance,
        EventLedger,
      },
      applyPagination,
      helpers: {
        safeString,
        toIso,
        classifyJourneyStatus,
      },
    },
  );
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
  return listDashboardJobs(
    {
      tenantId: tid,
      selectedVertical,
      selectedStatus,
      safePage,
      safeLimit,
      period,
    },
    {
      dbAvailable,
      Op,
      models: {
        ExecutionJob,
      },
      applyPagination,
      helpers: {
        mapExecutionStatus,
        computeDurationMs,
        toIso,
        safeString,
      },
    },
  );
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
  return listDashboardNotifications(
    {
      tenantId: tid,
      selectedVertical,
      selectedStatus,
      selectedChannel,
      safePage,
      safeLimit,
      period,
    },
    {
      dbAvailable,
      Op,
      models: {
        EventLedger,
        VerticalJourneyEvent,
      },
      applyPagination,
      helpers: {
        safeString,
        inferNotificationVertical,
        normalizeChannel,
        normalizeNotificationStatus,
        toIso,
        maskDestination,
        isNotificationJourneyEventType,
      },
    },
  );
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
  const { items, summary, meta } = await computeInsightsPayload({
    tenantId: tid,
    selectedVertical,
    safeLimit,
    period,
  });

  return {
    tenantId: tid,
    vertical: selectedVertical,
    period,
    items,
    summary,
    meta,
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
