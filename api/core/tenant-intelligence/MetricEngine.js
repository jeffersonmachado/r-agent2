'use strict';

const { getSequelize } = require('../../db/sequelize');
const { TenantMetricSnapshot } = require('../../db/models');
const { getEventLedgerMetrics } = require('../../services/eventLedgerMetricsService');
const { getGeneralMetrics } = require('../../services/analyticsService');
const { RecommendationEngine } = require('./RecommendationEngine');
const { buildId, toNumber, resolvePeriodBounds } = require('./helpers');

class MetricEngine {
  constructor(deps = {}) {
    this.recommendationEngine = deps.recommendationEngine || new RecommendationEngine();
  }

  async listSnapshots({ tenantId, metricKey = null, limit = 100, period = null } = {}) {
    if (!tenantId) throw new Error('tenantId is required');
    const SnapshotModel = TenantMetricSnapshot();

    const where = { tenant_key: String(tenantId) };
    if (metricKey) where.metric_key = String(metricKey);

    const bounds = period ? resolvePeriodBounds(period) : null;
    if (bounds) {
      where.period_start = { [require('sequelize').Op.gte]: bounds.start };
      where.period_end = { [require('sequelize').Op.lte]: bounds.end };
    }

    const rows = await SnapshotModel.findAll({
      where,
      order: [['period_end', 'DESC'], ['created_at', 'DESC']],
      limit: Math.min(Math.max(Number(limit) || 100, 1), 500),
    });

    const items = (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
    return { items, total: items.length };
  }

  async collectSnapshots({ tenantId, period = 'month', filters = {} } = {}) {
    if (!tenantId) throw new Error('tenantId is required');

    const bounds = resolvePeriodBounds(period, filters.period || {});
    const windowMinutes = Math.max(1, Math.round((bounds.end.getTime() - bounds.start.getTime()) / 60000));

    const metricsResult = await getEventLedgerMetrics({
      tenantId: String(tenantId),
      windowMinutes,
    });

    if (!metricsResult?.ok) {
      return {
        ok: false,
        error: metricsResult?.error || 'event_ledger_metrics_unavailable',
        snapshots: [],
      };
    }

    const metricRows = [];
    const metrics = metricsResult.metrics || {};
    const dispatch = metrics.dispatch?.summary || {};

    metricRows.push({ key: 'event_ledger.total_events', value: toNumber(metrics.total, 0) });
    metricRows.push({ key: 'event_ledger.recent_events', value: toNumber(metrics.recent, 0) });
    metricRows.push({ key: 'event_ledger.dispatch.pending', value: toNumber(dispatch.pending, 0) });
    metricRows.push({ key: 'event_ledger.dispatch.dead', value: toNumber(dispatch.dead, 0) });
    metricRows.push({ key: 'event_ledger.dispatch.done_recent', value: toNumber(dispatch.doneRecent, 0) });

    const concentration = await this.getEventTypeConcentration({
      tenantId: String(tenantId),
      periodStart: bounds.start,
      periodEnd: bounds.end,
    });

    if (concentration.total > 0) {
      metricRows.push({
        key: 'event_ledger.top_type_ratio',
        value: Number(concentration.ratio.toFixed(6)),
        metadata: {
          topType: concentration.topType,
          topTypeCount: concentration.topTypeCount,
          total: concentration.total,
        },
      });
    }

    // Metricas operacionais de negocio (best-effort): falha aqui nao
    // impede a persistencia das metricas do event ledger.
    const warnings = [];
    let operational = null;
    try {
      operational = await getGeneralMetrics({
        tenantId: String(tenantId),
        startDate: bounds.start.toISOString(),
        endDate: bounds.end.toISOString(),
      });
    } catch (_) {
      warnings.push('operational_metrics_unavailable');
    }

    if (operational && typeof operational === 'object') {
      // abandonmentRate/botContainmentRate sao fracoes 0..1: convertidas para %.
      const toPct = (value) => Number((toNumber(value, 0) * 100).toFixed(2));
      metricRows.push({ key: 'operations.tickets_total', value: toNumber(operational.totalTickets, 0), source: 'operations' });
      metricRows.push({ key: 'operations.tickets_open', value: toNumber(operational.openTickets, 0), source: 'operations' });
      metricRows.push({ key: 'operations.avg_first_response_minutes', value: toNumber(operational.avgFirstResponseTime, 0), source: 'operations' });
      metricRows.push({ key: 'operations.avg_resolution_minutes', value: toNumber(operational.avgResolutionTime, 0), source: 'operations' });
      metricRows.push({ key: 'operations.abandonment_rate_pct', value: toPct(operational.abandonmentRate), source: 'operations' });
      if (Number.isFinite(operational.botContainmentRate)) {
        metricRows.push({ key: 'operations.bot_containment_rate_pct', value: toPct(operational.botContainmentRate), source: 'operations' });
      }
    }

    const SnapshotModel = TenantMetricSnapshot();
    const snapshots = [];

    for (const metric of metricRows) {
      // V1 persists immutable snapshots to keep auditability by period.
      // eslint-disable-next-line no-await-in-loop
      const row = await SnapshotModel.create({
        id: buildId('metric'),
        tenant_key: String(tenantId),
        metric_key: metric.key,
        value: metric.value,
        period_start: bounds.start,
        period_end: bounds.end,
        dimensions: {
          period: bounds.type,
          ...(filters.dimensions && typeof filters.dimensions === 'object' ? filters.dimensions : {}),
        },
        source: metric.source || 'event_ledger',
        metadata: {
          windowMinutes,
          ...(metric.metadata || {}),
        },
      });
      snapshots.push(row.toJSON ? row.toJSON() : row);
    }

    // Fechamento event-driven do loop Decision Intelligence: snapshot novo
    // dispara a avaliacao das recomendacoes aplicadas (sem agendador).
    // Falha aqui nao impede a coleta — reportada como warning explicito.
    let outcomeEvaluation = null;
    try {
      outcomeEvaluation = await this.recommendationEngine.evaluatePendingOutcomes({
        tenantId: String(tenantId),
      });
    } catch (_) {
      warnings.push('outcome_evaluation_unavailable');
    }

    return {
      ok: true,
      snapshots,
      outcomeEvaluation,
      ...(warnings.length > 0 ? { warnings } : {}),
      period: {
        type: bounds.type,
        start: bounds.start.toISOString(),
        end: bounds.end.toISOString(),
      },
    };
  }

  async getEventTypeConcentration({ tenantId, periodStart, periodEnd } = {}) {
    const sequelize = getSequelize();
    if (!sequelize || !tenantId || !periodStart || !periodEnd) {
      return {
        topType: null,
        topTypeCount: 0,
        total: 0,
        ratio: 0,
      };
    }

    const replacements = {
      tenantKey: String(tenantId),
      periodStart,
      periodEnd,
    };

    const [totalRows] = await sequelize.query(
      `SELECT COUNT(*) AS total
       FROM event_ledger
       WHERE tenant_key = :tenantKey
         AND occurred_at >= :periodStart
         AND occurred_at <= :periodEnd`,
      { replacements },
    );

    const total = toNumber(totalRows?.[0]?.total, 0);
    if (total <= 0) {
      return {
        topType: null,
        topTypeCount: 0,
        total: 0,
        ratio: 0,
      };
    }

    const [topRows] = await sequelize.query(
      `SELECT type, COUNT(*) AS amount
       FROM event_ledger
       WHERE tenant_key = :tenantKey
         AND occurred_at >= :periodStart
         AND occurred_at <= :periodEnd
       GROUP BY type
       ORDER BY amount DESC
       LIMIT 1`,
      { replacements },
    );

    const topType = topRows?.[0]?.type ? String(topRows[0].type) : null;
    const topTypeCount = toNumber(topRows?.[0]?.amount, 0);

    return {
      topType,
      topTypeCount,
      total,
      ratio: topTypeCount > 0 ? topTypeCount / total : 0,
    };
  }
}

module.exports = {
  MetricEngine,
};
