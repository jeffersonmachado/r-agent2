'use strict';
const { OperationalMetricSnapshot } = require('../../db/models');
const { newId, getJson } = require('./shared');
const { getAggregatedMetrics } = require('./OperationalMetricsAggregator');
const { getInsights } = require('./PredictiveInsightsService');
const { getRuntime } = require('./AutonomousRuntimeService');

function snapshotDateValue(dateLike = new Date()) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

async function createSnapshots({ tenantId, snapshotDate = null, verticalTemplate = null, serviceType = null }) {
  const dateValue = snapshotDateValue(snapshotDate);
  const [runtimeOut, metricsOut] = await Promise.all([
    getRuntime(tenantId),
    getAggregatedMetrics({ tenantId, verticalTemplate, serviceType }),
  ]);

  const runtime = runtimeOut.runtime || {};
  const existingToday = await OperationalMetricSnapshot().count({
    where: {
      tenant_key: String(tenantId),
      snapshot_date: dateValue,
    },
  });
  if (existingToday >= Number(runtime.maxSnapshotsPerDay || 8)) {
    return {
      ok: true,
      created: 0,
      skipped: metricsOut.items?.length || 0,
      reasons: [{ code: 'snapshot_limit_reached', message: 'Limite diário de snapshots atingido para o tenant.' }],
      items: [],
    };
  }

  const created = [];
  let skipped = 0;
  const limit = Math.max(0, Number(runtime.maxSnapshotsPerDay || 8) - existingToday);

  for (const metric of (metricsOut.items || []).slice(0, limit)) {
    const insightOut = await getInsights({
      tenantId,
      verticalTemplate: metric.verticalTemplate,
      serviceType: metric.serviceType,
      metricsOverride: metric,
      runtimeOverride: runtime,
    });
    const dedupeWhere = {
      tenant_key: String(tenantId),
      snapshot_date: dateValue,
      vertical_template: metric.verticalTemplate || 'beauty',
      service_type: metric.serviceType || null,
      owner_id: metric.ownerId || null,
      team_id: metric.teamId || null,
      day_of_week: Number.isInteger(metric.weekday) ? metric.weekday : 0,
      hour_bucket: Number.isInteger(metric.hourBucket) ? metric.hourBucket : 0,
    };
    const existing = await OperationalMetricSnapshot().findOne({ where: dedupeWhere });
    const payload = {
      ...dedupeWhere,
      open_campaigns: metric.campaignsOpen || 0,
      filled_campaigns: metric.campaignsFilled || 0,
      accepted_candidates: metric.acceptedCandidates || 0,
      expired_campaigns: metric.campaignsExpired || 0,
      fill_rate: metric.fillRate || 0,
      accept_rate: metric.acceptRate || 0,
      avg_fill_minutes: metric.avgFillMinutes || 0,
      idle_risk_score: insightOut?.insights?.idleRiskScore ?? null,
      no_show_risk_score: insightOut?.insights?.noShowRiskScore ?? null,
    };
    if (existing) {
      await existing.update(payload);
      created.push(getJson(existing));
    } else {
      const row = await OperationalMetricSnapshot().create({
        id: newId('oms'),
        ...payload,
      });
      created.push(getJson(row));
    }
  }

  skipped += Math.max(0, (metricsOut.items || []).length - limit);

  return {
    ok: true,
    created: created.length,
    skipped,
    snapshotDate: dateValue,
    items: created,
  };
}

async function listSnapshots({ tenantId, verticalTemplate = null, serviceType = null, limit = 50, snapshotDate = null }) {
  const where = { tenant_key: String(tenantId) };
  if (verticalTemplate) where.vertical_template = String(verticalTemplate);
  if (serviceType) where.service_type = String(serviceType);
  if (snapshotDate) {
    where.snapshot_date = snapshotDateValue(snapshotDate);
  }
  const rows = await OperationalMetricSnapshot().findAll({
    where,
    order: [['snapshot_date', 'DESC'], ['created_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 20, 1), 200),
  });
  return { ok: true, items: rows.map(getJson) };
}

module.exports = {
  createSnapshots,
  listSnapshots,
};
