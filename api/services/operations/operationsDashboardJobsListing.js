'use strict';

const {
  mapJobRows,
  aggregateJobsByKind,
  buildJobsSummary,
} = require('./operationsDashboardJobsAggregator');

/**
 * Executes jobs query flow and assembles API payload.
 *
 * @param {{tenantId: string, selectedVertical: string, selectedJobId: string|null, selectedStatus: string|null, safePage: number, safeLimit: number, period: {startDate: Date, endDate: Date}}} params
 * @param {{dbAvailable: Function, Op: Object, models: {ExecutionJob: Function}, applyPagination: Function, helpers: Object}} deps
 * @returns {Promise<Object>}
 */
async function listDashboardJobs(params, deps) {
  const {
    tenantId,
    selectedVertical,
    selectedJobId,
    selectedStatus,
    safePage,
    safeLimit,
    period,
  } = params;

  const {
    dbAvailable,
    Op,
    models,
    applyPagination,
    helpers,
  } = deps;

  const { ExecutionJob } = models;

  if (!dbAvailable()) {
    return {
      tenantId,
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
    tenant_key: tenantId,
    kind: {
      [Op.or]: [
        { [Op.like]: 'vertical_%' },
        { [Op.eq]: 'billing_reconciliation' },
        { [Op.eq]: 'vertical_notification_dispatch' },
      ],
    },
    created_at: { [Op.between]: [period.startDate, period.endDate] },
  };

  if (selectedVertical === 'beauty') {
    where.kind = { [Op.in]: ['vertical_beauty_journey_tick', 'vertical_beauty_noshow_scan', 'vertical_beauty_reactivation_scan', 'vertical_reconciliation', 'billing_reconciliation', 'vertical_notification_dispatch'] };
  } else if (selectedVertical === 'fitness') {
    where.kind = { [Op.in]: ['vertical_fitness_journey_tick', 'vertical_fitness_inactivity_scan', 'vertical_fitness_grace_expiry_scan', 'vertical_reconciliation', 'billing_reconciliation', 'vertical_notification_dispatch'] };
  }

  const rows = await ExecutionJob().findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: 5000,
  }).catch(() => []);

  let jobs = mapJobRows(rows, helpers);
  if (selectedJobId) {
    jobs = jobs.filter((job) => String(job.id || '') === selectedJobId);
  }
  if (selectedStatus) {
    jobs = jobs.filter((job) => job.status === selectedStatus);
  }

  const summary = buildJobsSummary(jobs);
  const byKind = aggregateJobsByKind(jobs);
  const paged = applyPagination(jobs, { page: safePage, limit: safeLimit });

  return {
    tenantId,
    vertical: selectedVertical,
    period,
    summary,
    byKind,
    items: paged.items,
    pagination: paged.pagination,
    meta: { warnings: [] },
  };
}

module.exports = {
  listDashboardJobs,
};
