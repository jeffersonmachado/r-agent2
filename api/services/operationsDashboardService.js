'use strict';

const { Op } = require('sequelize');
const {
  VerticalJourneyEvent,
  VerticalAttendance,
  VerticalEngagementSignal,
  AccessMembership,
  ExecutionJob,
  EventLedger,
  BillingTransaction,
  NotificationDelivery,
} = require('../db/models');
const { getSequelize } = require('../db/sequelize');
const { computeVerticalMetrics } = require('./vertical/verticalMetricsEngine');
const { getBillingOpsMetrics } = require('./billingOpsMetricsService');
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
        NotificationDelivery,
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
      getBillingOpsMetrics,
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
  jobId = null,
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
      selectedJobId: safeString(jobId || '').trim() || null,
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
        NotificationDelivery,
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

async function listFinancialTransactions({
  tenantId,
  vertical = 'all',
  startDate,
  endDate,
  status = null,
  provider = null,
  problemOnly = false,
  page = 1,
  limit = 20,
}) {
  const tid = ensureTenant(tenantId);
  const selectedVertical = normalizeVertical(vertical);
  const selectedStatus = safeString(status || '').trim().toLowerCase() || null;
  const selectedProvider = safeString(provider || '').trim().toLowerCase() || null;
  const safePage = normalizePage(page, 1);
  const safeLimit = normalizeLimit(limit, 20, 100);
  const period = normalizePeriod({ startDate, endDate, defaultWindowDays: 30 });

  async function fetchLastReconciliation() {
    const row = await EventLedger().findOne({
      where: {
        tenant_key: tid,
        type: 'VerticalJourney_Custom',
        source: {
          [Op.in]: ['billing.reconciliation.manual', 'billing.reconciliation.scheduler'],
        },
      },
      order: [['occurred_at', 'DESC'], ['received_at', 'DESC']],
    }).catch(() => null);

    if (!row) return null;
    const json = typeof row?.toJSON === 'function' ? row.toJSON() : row;
    const payload = json?.payload || {};
    if (!['billing_reconciliation_manual', 'billing_reconciliation_scheduled'].includes(payload.kind)) return null;

    return {
      executedAt: toIso(json.occurred_at || json.occurredAt || json.received_at || json.receivedAt),
      source: safeString(json.source || '', '') || null,
      mode: payload.kind === 'billing_reconciliation_scheduled' ? 'scheduler' : 'manual',
      correlationId: safeString(json.correlation_id || json.correlationId || '', '') || null,
      actorType: safeString(json.actor_type || json.actorType || '', '') || null,
      actorId: safeString(json.actor_id || json.actorId || '', '') || null,
      jobId: safeString(payload.jobId || '', '') || null,
      transactions: payload.transactions || null,
      subscriptions: payload.subscriptions || null,
      limit: Number(payload.limit || 0) || null,
    };
  }

  if (!dbAvailable()) {
    return {
      tenantId: tid,
      vertical: selectedVertical,
      period,
      items: [],
      pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 1 },
      summary: {
        total: 0,
        problematicCount: 0,
        confirmedCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        refundedCount: 0,
        chargebackCount: 0,
        cancelledCount: 0,
        grossAmount: 0,
        problematicAmount: 0,
      },
      meta: { warnings: ['db_unavailable'], dataSource: 'billing_transactions' },
    };
  }

  const lastReconciliation = await fetchLastReconciliation();

  const where = {
    tenant_key: tid,
    created_at: {
      [Op.between]: [period.startDate, period.endDate],
    },
  };

  if (selectedVertical !== 'all') {
    where.vertical = selectedVertical;
  }

  if (selectedProvider) {
    where.provider = selectedProvider;
  }

  if (selectedStatus) {
    where.status = selectedStatus;
  } else if (problemOnly) {
    where.status = {
      [Op.in]: ['pending', 'overdue', 'refunded', 'chargeback', 'cancelled'],
    };
  }

  const rows = await BillingTransaction().findAll({
    where,
    order: [
      ['updated_at', 'DESC'],
      ['created_at', 'DESC'],
    ],
  });

  const normalizedRows = rows
    .map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row))
    .filter((row) => {
      const rowStatus = safeString(row?.status || '').trim().toLowerCase();
      const rowProvider = safeString(row?.provider || '').trim().toLowerCase();
      const rowVertical = safeString(row?.vertical || '').trim().toLowerCase();

      if (selectedVertical !== 'all' && rowVertical !== selectedVertical) return false;
      if (selectedProvider && rowProvider !== selectedProvider) return false;
      if (selectedStatus && rowStatus !== selectedStatus) return false;
      if (!selectedStatus && problemOnly && !['pending', 'overdue', 'refunded', 'chargeback', 'cancelled'].includes(rowStatus)) return false;
      return true;
    });

  const summary = normalizedRows.reduce((acc, row) => {
    const nextStatus = safeString(row?.status || '').trim().toLowerCase();
    const amount = Number(row?.amount || 0);

    acc.total += 1;
    acc.grossAmount += Number.isFinite(amount) ? amount : 0;

    if (nextStatus === 'confirmed') acc.confirmedCount += 1;
    if (nextStatus === 'pending') acc.pendingCount += 1;
    if (nextStatus === 'overdue') acc.overdueCount += 1;
    if (nextStatus === 'refunded') acc.refundedCount += 1;
    if (nextStatus === 'chargeback') acc.chargebackCount += 1;
    if (nextStatus === 'cancelled') acc.cancelledCount += 1;

    if (['pending', 'overdue', 'refunded', 'chargeback', 'cancelled'].includes(nextStatus)) {
      acc.problematicCount += 1;
      acc.problematicAmount += Number.isFinite(amount) ? amount : 0;
    }

    return acc;
  }, {
    total: 0,
    problematicCount: 0,
    confirmedCount: 0,
    pendingCount: 0,
    overdueCount: 0,
    refundedCount: 0,
    chargebackCount: 0,
    cancelledCount: 0,
    grossAmount: 0,
    problematicAmount: 0,
  });

  const paged = applyPagination(normalizedRows, { page: safePage, limit: safeLimit });

  return {
    tenantId: tid,
    vertical: selectedVertical,
    period,
    items: paged.items.map((row) => ({
      id: row.id,
      createdAt: toIso(row.created_at || row.createdAt),
      updatedAt: toIso(row.updated_at || row.updatedAt),
      dueAt: toIso(row.due_at || row.dueAt),
      paidAt: toIso(row.paid_at || row.paidAt),
      vertical: safeString(row.vertical || '-'),
      provider: safeString(row.provider || '-'),
      type: safeString(row.type || '-'),
      status: safeString(row.status || '-'),
      amount: Number(row.amount || 0),
      currency: safeString(row.currency || 'BRL', 'BRL'),
      subjectId: row.subject_id || null,
      customerId: row.customer_id || null,
      membershipId: row.membership_id || null,
      bundleId: row.bundle_id || null,
      externalTransactionId: row.external_transaction_id || null,
      externalSubscriptionId: row.external_subscription_id || null,
      metadata: row.metadata || {},
    })),
    pagination: paged.pagination,
    summary,
    meta: {
      warnings: [],
      dataSource: 'billing_transactions',
      lastReconciliation,
      filters: {
        status: selectedStatus,
        provider: selectedProvider,
        problemOnly: !!problemOnly && !selectedStatus,
      },
    },
  };
}

module.exports = {
  computeSummary,
  listTimeline,
  listJobs,
  listNotifications,
  listInsights,
  listFinancialTransactions,
  helpers: {
    normalizeNotificationStatus,
    classifyJourneyStatus,
    mapExecutionStatus,
  },
};
