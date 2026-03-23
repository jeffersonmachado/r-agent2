'use strict';

/**
 * Summary computation helper for Operations Dashboard.
 * Keeps DB fetch + aggregation logic out of the service orchestrator.
 */

/**
 * @param {{tenantId: string, selectedVertical: string, period: {startDate: Date, endDate: Date}}} params
 * @param {{dbAvailable: Function, Op: Object, models: Object, computeVerticalMetrics: Function, safeString: Function, safeDate: Function, startOfDay: Function, endOfDay: Function, normalizeNotificationStatus: Function}} deps
 * @returns {Promise<Object>}
 */
async function computeDashboardSummary({ tenantId, selectedVertical, period }, deps) {
  const {
    dbAvailable,
    Op,
    models,
    computeVerticalMetrics,
    safeString,
    safeDate,
    startOfDay,
    endOfDay,
    normalizeNotificationStatus,
  } = deps;
  const {
    VerticalJourneyEvent,
    VerticalAttendance,
    VerticalEngagementSignal,
    AccessMembership,
    ExecutionJob,
    EventLedger,
  } = models;

  if (!dbAvailable()) {
    return {
      tenantId,
      vertical: selectedVertical,
      period,
      summary: {
        beauty: null,
        fitness: null,
        system: null,
      },
      byVertical: {},
      meta: {
        warnings: ['db_unavailable'],
        derivedMetrics: [],
      },
    };
  }

  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());

  const journeyWhere = {
    tenant_key: tenantId,
    occurred_at: { [Op.between]: [period.startDate, period.endDate] },
  };

  const attendanceWhere = {
    tenant_key: tenantId,
    checked_in_at: { [Op.between]: [period.startDate, period.endDate] },
  };

  const executionWhere = {
    tenant_key: tenantId,
    kind: { [Op.like]: 'vertical_%' },
    created_at: { [Op.between]: [period.startDate, period.endDate] },
  };

  const [
    journeyRows,
    attendanceRows,
    engagementRows,
    membershipsRows,
    jobsRows,
    notificationLedgerRows,
    beautyMetrics,
    fitnessMetrics,
  ] = await Promise.all([
    VerticalJourneyEvent().findAll({
      where: journeyWhere,
      attributes: ['vertical', 'event_type', 'occurred_at', 'channel', 'status', 'subject_id'],
      limit: 20000,
    }).catch(() => []),
    VerticalAttendance().findAll({
      where: attendanceWhere,
      attributes: ['vertical', 'status', 'checked_in_at', 'subject_id'],
      limit: 20000,
    }).catch(() => []),
    VerticalEngagementSignal().findAll({
      where: {
        tenant_key: tenantId,
        vertical: 'fitness',
        computed_at: { [Op.between]: [period.startDate, period.endDate] },
      },
      attributes: ['subject_id', 'signal_type', 'score', 'computed_at'],
      order: [['computed_at', 'DESC']],
      limit: 20000,
    }).catch(() => []),
    AccessMembership().findAll({
      where: { tenant_key: tenantId, vertical: { [Op.in]: ['beauty', 'fitness'] } },
      attributes: ['id', 'vertical', 'billing_status', 'status', 'subject_id'],
      limit: 20000,
    }).catch(() => []),
    ExecutionJob().findAll({
      where: executionWhere,
      attributes: ['id', 'status', 'attempts', 'processing_at', 'updated_at'],
      limit: 20000,
    }).catch(() => []),
    EventLedger().findAll({
      where: {
        tenant_key: tenantId,
        type: 'VerticalJourney_Custom',
        source: { [Op.like]: 'vertical.notification.%' },
        occurred_at: { [Op.between]: [period.startDate, period.endDate] },
      },
      attributes: ['payload', 'occurred_at'],
      limit: 20000,
    }).catch(() => []),
    computeVerticalMetrics({ tenantId, vertical: 'beauty', windowDays: 30 }).catch(() => null),
    computeVerticalMetrics({ tenantId, vertical: 'fitness', windowDays: 30 }).catch(() => null),
  ]);

  const journeys = journeyRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const attendances = attendanceRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const engagementSignals = engagementRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const memberships = membershipsRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const jobs = jobsRows.map((r) => (r.toJSON ? r.toJSON() : r));
  const notificationEvents = notificationLedgerRows
    .map((r) => (r.toJSON ? r.toJSON() : r))
    .filter((row) => row?.payload?.kind === 'notification_delivery');

  const latestSignalBySubject = {};
  for (const row of engagementSignals) {
    const subjectId = safeString(row.subject_id || '');
    if (!subjectId || latestSignalBySubject[subjectId]) continue;
    latestSignalBySubject[subjectId] = row;
  }

  const beautyJourneyToday = journeys.filter((item) => {
    if (item.vertical !== 'beauty') return false;
    const dt = safeDate(item.occurred_at, null);
    if (!dt) return false;
    return dt >= todayStart && dt <= todayEnd;
  });

  const fitnessAttendanceToday = attendances.filter((item) => {
    if (item.vertical !== 'fitness') return false;
    const dt = safeDate(item.checked_in_at, null);
    if (!dt) return false;
    return dt >= todayStart && dt <= todayEnd;
  });

  const beautySummary = {
    appointmentsToday: beautyJourneyToday.filter((x) => x.event_type === 'confirmation_sent').length,
    completedServices: beautyJourneyToday.filter((x) => x.event_type === 'service_completed').length,
    noShow: beautyJourneyToday.filter((x) => x.event_type === 'no_show_detected').length,
    reactivations: beautyJourneyToday.filter((x) => x.event_type === 'reactivation_sent').length,
  };

  const fitnessSummary = {
    checkInsToday: fitnessAttendanceToday.length,
    activeStudents: memberships.filter((m) => m.vertical === 'fitness' && m.billing_status === 'active').length,
    lowFrequency: Object.values(latestSignalBySubject).filter((s) => s.signal_type === 'low_frequency').length,
    blocked: memberships.filter((m) => m.vertical === 'fitness' && m.billing_status === 'blocked').length,
  };

  const jobsExecuted = jobs.filter((j) => j.status === 'done' || j.status === 'dead').length;
  const jobsError = jobs.filter((j) => j.status === 'dead').length;

  const notificationsSent = notificationEvents.filter((e) => normalizeNotificationStatus(e?.payload?.dashboardStatus) === 'sent').length;
  const notificationFailures = notificationEvents.filter((e) => normalizeNotificationStatus(e?.payload?.dashboardStatus) === 'failed').length;

  const systemSummary = {
    jobsExecuted,
    jobsError,
    notificationsSent,
    notificationFailures,
  };

  const byVertical = {
    beauty: beautyMetrics,
    fitness: fitnessMetrics,
  };

  const outputSummary = {
    beauty: selectedVertical === 'fitness' ? null : beautySummary,
    fitness: selectedVertical === 'beauty' ? null : fitnessSummary,
    system: systemSummary,
  };

  return {
    tenantId,
    vertical: selectedVertical,
    period,
    summary: outputSummary,
    byVertical,
    meta: {
      warnings: [],
      derivedMetrics: [
        {
          metric: 'beauty.appointmentsToday',
          source: 'VerticalJourneyEvent(event_type=confirmation_sent)',
          exact: false,
          note: 'Proxy de agendamentos confirmados no dia.',
        },
        {
          metric: 'fitness.lowFrequency',
          source: 'VerticalEngagementSignal(latest signal_type=low_frequency)',
          exact: false,
          note: 'Derivado do sinal mais recente por aluno no período.',
        },
      ],
    },
  };
}

module.exports = {
  computeDashboardSummary,
};
