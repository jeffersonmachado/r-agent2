'use strict';

const { getSequelize } = require('../../db/sequelize');

function safeInt(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

function safeNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function resolveAlertSeverity({ triggered, growthFactor, growthFactorThreshold }) {
  if (triggered !== true) return 'ok';
  return growthFactor >= Math.max(growthFactorThreshold * 2, 4) ? 'critical' : 'warning';
}

async function getOrderAttributionExceptions({ tenantId, windowDays = 7, limit = 20 } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };

  const safeWindowDays = Math.min(Math.max(safeInt(windowDays, 7), 1), 90);
  const safeLimit = Math.min(Math.max(safeInt(limit, 20), 1), 100);
  const growthWindowDays = Math.min(safeWindowDays, 7);
  const minRecentMissing = Math.max(1, Math.min(safeInt(process.env.MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_MIN_EVENTS, 3), 1000));
  const growthFactorThreshold = Math.max(1, Math.min(safeNumber(process.env.MARKETING_GOOGLE_ADS_ATTRIBUTION_ALERT_GROWTH_FACTOR, 2), 100));
  const replacements = {
    tenantKey: String(tenantId || ''),
    windowDays: safeWindowDays,
    limit: safeLimit,
  };

  const [summaryRows] = await sequelize.query(
    `SELECT
       COUNT(*)::int AS total_missing,
       COUNT(*) FILTER (
         WHERE occurred_at >= NOW() - (:windowDays * INTERVAL '1 day')
       )::int AS recent_missing,
       COUNT(DISTINCT subject_id) FILTER (
         WHERE occurred_at >= NOW() - (:windowDays * INTERVAL '1 day')
       )::int AS distinct_orders_recent,
       MAX(occurred_at) AS last_occurred_at
     FROM event_ledger
     WHERE tenant_key = :tenantKey
       AND type = 'OrderMarketingAttributionMissing'`,
    { replacements },
  );

  const [bySourceRows] = await sequelize.query(
    `SELECT
       source,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (
         WHERE occurred_at >= NOW() - (:windowDays * INTERVAL '1 day')
       )::int AS recent
     FROM event_ledger
     WHERE tenant_key = :tenantKey
       AND type = 'OrderMarketingAttributionMissing'
     GROUP BY source
     ORDER BY recent DESC, total DESC, source ASC`,
    { replacements },
  );

  const [rows] = await sequelize.query(
    `SELECT
       id,
       occurred_at,
       correlation_id,
       source,
       subject_id,
       payload
     FROM event_ledger
     WHERE tenant_key = :tenantKey
       AND type = 'OrderMarketingAttributionMissing'
       AND occurred_at >= NOW() - (:windowDays * INTERVAL '1 day')
     ORDER BY occurred_at DESC
     LIMIT :limit`,
    { replacements },
  );

  const summary = Array.isArray(summaryRows) && summaryRows[0] ? summaryRows[0] : {};
  const growth = await getOrderAttributionGrowthStatus({
    tenantId,
    windowDays: growthWindowDays,
    minRecentMissing,
    growthFactorThreshold,
  });

  return {
    ok: true,
    tenantId: String(tenantId || ''),
    windowDays: safeWindowDays,
    total: safeLimit,
    summary: {
      totalMissing: Number(summary.total_missing || 0),
      recentMissing: Number(summary.recent_missing || 0),
      distinctOrdersRecent: Number(summary.distinct_orders_recent || 0),
      lastOccurredAt: summary.last_occurred_at ? new Date(summary.last_occurred_at).toISOString() : null,
    },
    alert: growth && growth.ok ? {
      windowDays: growth.windowDays,
      triggered: growth.triggered === true,
      severity: resolveAlertSeverity({
        triggered: growth.triggered === true,
        growthFactor: growth.growthFactor,
        growthFactorThreshold,
      }),
      currentCount: growth.currentCount,
      previousCount: growth.previousCount,
      distinctOrdersCurrent: growth.distinctOrdersCurrent,
      growthFactor: growth.growthFactor,
      thresholds: growth.thresholds,
      lastOccurredAt: growth.lastOccurredAt,
    } : null,
    bySource: (Array.isArray(bySourceRows) ? bySourceRows : []).map((row) => ({
      source: String(row.source || 'orders'),
      total: Number(row.total || 0),
      recent: Number(row.recent || 0),
    })),
    items: (Array.isArray(rows) ? rows : []).map((row) => ({
      id: String(row.id || ''),
      occurredAt: row.occurred_at ? new Date(row.occurred_at).toISOString() : null,
      correlationId: row.correlation_id ? String(row.correlation_id) : null,
      source: String(row.source || 'orders'),
      orderId: row.subject_id ? String(row.subject_id) : null,
      payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    })),
  };
}

async function getOrderAttributionGrowthStatus({ tenantId, windowDays = 1, minRecentMissing = 3, growthFactorThreshold = 2 } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };

  const safeWindowDays = Math.min(Math.max(safeInt(windowDays, 1), 1), 30);
  const safeMinRecentMissing = Math.min(Math.max(safeInt(minRecentMissing, 3), 1), 1000);
  const safeGrowthFactorThreshold = Math.min(Math.max(safeNumber(growthFactorThreshold, 2), 1), 100);
  const replacements = {
    tenantKey: String(tenantId || ''),
    windowDays: safeWindowDays,
  };

  const [rows] = await sequelize.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE occurred_at >= NOW() - (:windowDays * INTERVAL '1 day')
       )::int AS current_count,
       COUNT(*) FILTER (
         WHERE occurred_at < NOW() - (:windowDays * INTERVAL '1 day')
           AND occurred_at >= NOW() - ((:windowDays * 2) * INTERVAL '1 day')
       )::int AS previous_count,
       COUNT(DISTINCT subject_id) FILTER (
         WHERE occurred_at >= NOW() - (:windowDays * INTERVAL '1 day')
       )::int AS distinct_orders_current,
       MAX(occurred_at) FILTER (
         WHERE occurred_at >= NOW() - (:windowDays * INTERVAL '1 day')
       ) AS last_occurred_at
     FROM event_ledger
     WHERE tenant_key = :tenantKey
       AND type = 'OrderMarketingAttributionMissing'`,
    { replacements },
  );

  const row = Array.isArray(rows) && rows[0] ? rows[0] : {};
  const currentCount = Number(row.current_count || 0);
  const previousCount = Number(row.previous_count || 0);
  const distinctOrdersCurrent = Number(row.distinct_orders_current || 0);
  const lastOccurredAt = row.last_occurred_at ? new Date(row.last_occurred_at).toISOString() : null;
  const growthFactor = previousCount > 0 ? currentCount / previousCount : (currentCount > 0 ? currentCount : 0);
  const triggered = currentCount >= safeMinRecentMissing
    && (previousCount === 0 ? currentCount >= safeMinRecentMissing : growthFactor >= safeGrowthFactorThreshold);
  const severity = resolveAlertSeverity({ triggered, growthFactor, growthFactorThreshold: safeGrowthFactorThreshold });

  return {
    ok: true,
    tenantId: String(tenantId || ''),
    windowDays: safeWindowDays,
    thresholds: {
      minRecentMissing: safeMinRecentMissing,
      growthFactorThreshold: safeGrowthFactorThreshold,
    },
    currentCount,
    previousCount,
    distinctOrdersCurrent,
    growthFactor,
    lastOccurredAt,
    severity,
    triggered,
  };
}

module.exports = {
  getOrderAttributionExceptions,
  getOrderAttributionGrowthStatus,
};