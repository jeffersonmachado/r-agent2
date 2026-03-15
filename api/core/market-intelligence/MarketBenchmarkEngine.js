'use strict';

const { Op } = require('sequelize');
const { MarketMetricAggregate, MarketBenchmark, TenantMetricSnapshot } = require('../../db/models');
const tenantService = require('../../services/tenantService');
const { buildId, toNumber } = require('../tenant-intelligence/helpers');

const LOWER_IS_BETTER_METRICS = new Set([
  'no_show_rate',
  'cancellation_rate',
  'cancel_rate',
  'churn_rate',
  'avg_response_time',
  'average_response_time',
  'sla_breach_rate',
]);
const MIN_BENCHMARK_SAMPLE_SIZE = 5;

class MarketBenchmarkEngine {
  async calculateBenchmark(tenantKey, metricKey, options = {}) {
    if (!tenantKey) throw new Error('tenantKey is required');
    if (!metricKey) throw new Error('metricKey is required');

    const tenantMetric = await this._getTenantMetricValue(tenantKey, metricKey);
    if (!tenantMetric) {
      return {
        ok: false,
        error: 'tenant_metric_not_found',
        metric: String(metricKey),
      };
    }

    const profile = this._resolveTenantProfile(tenantKey, options);
    const aggregate = await this._findAggregate({
      metricKey,
      vertical: profile.vertical,
      region: profile.region,
      periodEnd: tenantMetric.period_end,
    });

    if (!aggregate) {
      return {
        ok: false,
        error: 'market_aggregate_not_found',
        metric: String(metricKey),
        tenant_value: tenantMetric.value,
      };
    }

    if (toNumber(aggregate.sample_size, 0) < MIN_BENCHMARK_SAMPLE_SIZE) {
      return {
        ok: false,
        error: 'insufficient_anonymized_sample',
        metric: String(metricKey),
      };
    }

    const tenantValue = toNumber(tenantMetric.value, 0);
    const marketAvg = toNumber(aggregate.avg_value, 0);
    const marketMedian = toNumber(aggregate.median_value, 0);
    const marketP90 = toNumber(aggregate.p90_value, marketMedian);
    const percentile = this._estimatePercentile({ tenantValue, marketAvg, marketMedian, marketP90 });
    const status = this._resolveStatus(metricKey, tenantValue, marketAvg);
    const now = new Date();

    const payload = {
      metric: String(metricKey),
      tenant_value: tenantValue,
      market_avg: marketAvg,
      market_median: marketMedian,
      percentile,
      status,
      evaluated_at: now.toISOString(),
      metadata: {
        vertical: aggregate.vertical,
        region: aggregate.region,
        sample_size: toNumber(aggregate.sample_size, 0),
        aggregate_period_start: aggregate.period_start,
        aggregate_period_end: aggregate.period_end,
        better_direction: LOWER_IS_BETTER_METRICS.has(String(metricKey)) ? 'down' : 'up',
      },
    };

    const BenchmarkModel = MarketBenchmark();
    await BenchmarkModel.create({
      id: buildId('market-benchmark'),
      tenant_key: String(tenantKey),
      metric_key: String(metricKey),
      tenant_value: tenantValue,
      market_avg: marketAvg,
      market_median: marketMedian,
      percentile,
      evaluated_at: now,
      metadata: payload.metadata,
    });

    return payload;
  }

  _resolveTenantProfile(tenantKey, options = {}) {
    const tenantContext = tenantService.getTenantContext(String(tenantKey)) || {};
    return {
      vertical: String(
        options.vertical
        || tenantContext?.ramo_atividade
        || tenantContext?.metadata?.vertical
        || 'global',
      ),
      region: String(
        options.region
        || tenantContext?.metadata?.region
        || 'global',
      ),
    };
  }

  async _getTenantMetricValue(tenantKey, metricKey) {
    const SnapshotModel = TenantMetricSnapshot();
    const row = await SnapshotModel.findOne({
      where: {
        tenant_key: String(tenantKey),
        metric_key: String(metricKey),
      },
      order: [['period_end', 'DESC'], ['created_at', 'DESC']],
    });

    return row ? (row.toJSON ? row.toJSON() : row) : null;
  }

  async _findAggregate({ metricKey, vertical, region, periodEnd }) {
    const AggregateModel = MarketMetricAggregate();
    const lookups = [
      {
        metric_key: String(metricKey),
        vertical: { [Op.in]: [String(vertical), 'global'] },
        region: { [Op.in]: [String(region), 'global'] },
        ...(periodEnd ? { period_end: { [Op.gte]: periodEnd } } : {}),
      },
      {
        metric_key: String(metricKey),
        vertical: { [Op.in]: [String(vertical), 'global'] },
        region: { [Op.in]: [String(region), 'global'] },
      },
    ];

    for (const where of lookups) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await AggregateModel.findAll({
        where,
        order: [
          ['period_end', 'DESC'],
          ['sample_size', 'DESC'],
        ],
        limit: 5,
      });
      const items = (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
      if (items[0]) return items[0];
    }

    return null;
  }

  _estimatePercentile({ tenantValue, marketAvg, marketMedian, marketP90 }) {
    if (!Number.isFinite(tenantValue)) return 50;
    if (tenantValue <= marketMedian) {
      if (marketMedian === 0) return 50;
      return Math.max(1, Math.min(50, Math.round((tenantValue / marketMedian) * 50)));
    }

    const upperBand = marketP90 > marketMedian ? (marketP90 - marketMedian) : Math.max(Math.abs(marketAvg), 1);
    const ratio = upperBand > 0 ? (tenantValue - marketMedian) / upperBand : 0;
    return Math.max(50, Math.min(99, Math.round(50 + (ratio * 40))));
  }

  _resolveStatus(metricKey, tenantValue, marketAvg) {
    const diff = tenantValue - marketAvg;
    const threshold = Math.max(Math.abs(marketAvg) * 0.05, 0.0001);
    const lowerIsBetter = LOWER_IS_BETTER_METRICS.has(String(metricKey));

    if (Math.abs(diff) <= threshold) return 'within_market';
    if (lowerIsBetter) return diff > 0 ? 'above_market' : 'below_market';
    return diff > 0 ? 'above_market' : 'below_market';
  }
}

module.exports = {
  MarketBenchmarkEngine,
  LOWER_IS_BETTER_METRICS,
  MIN_BENCHMARK_SAMPLE_SIZE,
};
