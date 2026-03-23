'use strict';

const {
  mapJourneyTimelineItems,
  mapAttendanceTimelineItems,
  mapMembershipTimelineItems,
} = require('./operationsDashboardTimelineMapper');

/**
 * Executes timeline query flow and assembles API payload.
 *
 * @param {{tenantId: string, selectedVertical: string, selectedStatus: string|null, subjectId: string|null, customerId: string|null, membershipId: string|null, safePage: number, safeLimit: number, period: {startDate: Date, endDate: Date}}} params
 * @param {{dbAvailable: Function, Op: Object, models: {VerticalJourneyEvent: Function, VerticalAttendance: Function, EventLedger: Function}, applyPagination: Function, helpers: Object}} deps
 * @returns {Promise<Object>}
 */
async function listDashboardTimeline(params, deps) {
  const {
    tenantId,
    selectedVertical,
    selectedStatus,
    subjectId,
    customerId,
    membershipId,
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

  const {
    VerticalJourneyEvent,
    VerticalAttendance,
    EventLedger,
  } = models;

  const {
    safeString,
    toIso,
    classifyJourneyStatus,
  } = helpers;

  if (!dbAvailable()) {
    return {
      tenantId,
      vertical: selectedVertical,
      period,
      items: [],
      pagination: { page: safePage, limit: safeLimit, total: 0, totalPages: 1 },
      meta: { warnings: ['db_unavailable'] },
    };
  }

  const verticalFilter = selectedVertical === 'all' ? { [Op.in]: ['beauty', 'fitness'] } : selectedVertical;

  const journeyWhere = {
    tenant_key: tenantId,
    vertical: verticalFilter,
    occurred_at: { [Op.between]: [period.startDate, period.endDate] },
  };
  if (subjectId) journeyWhere.subject_id = safeString(subjectId);
  if (customerId) journeyWhere.customer_id = safeString(customerId);
  if (membershipId) journeyWhere.membership_id = safeString(membershipId);

  const attendanceWhere = {
    tenant_key: tenantId,
    vertical: verticalFilter,
    checked_in_at: { [Op.between]: [period.startDate, period.endDate] },
  };
  if (subjectId) attendanceWhere.subject_id = safeString(subjectId);
  if (membershipId) attendanceWhere.membership_id = safeString(membershipId);

  const membershipHistoryWhere = {
    tenant_key: tenantId,
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

  const journeyItems = mapJourneyTimelineItems(journeyRows, { toIso, classifyJourneyStatus });
  const attendanceItems = mapAttendanceTimelineItems(attendanceRows, { toIso });
  const membershipItems = mapMembershipTimelineItems(membershipHistoryRows, { toIso, safeString });

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
    tenantId,
    vertical: selectedVertical,
    period,
    items: paged.items,
    pagination: paged.pagination,
    meta: {
      warnings: [],
    },
  };
}

module.exports = {
  listDashboardTimeline,
};
