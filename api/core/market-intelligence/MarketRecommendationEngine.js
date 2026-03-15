'use strict';

const { MarketPlaybook, TenantMetricSnapshot } = require('../../db/models');
const { MarketBenchmarkEngine, LOWER_IS_BETTER_METRICS } = require('./MarketBenchmarkEngine');

class MarketRecommendationEngine {
  constructor({ marketBenchmarkEngine } = {}) {
    this.marketBenchmarkEngine = marketBenchmarkEngine || new MarketBenchmarkEngine();
  }

  async recommendActions(tenantKey, options = {}) {
    if (!tenantKey) throw new Error('tenantKey is required');

    const metrics = await this._listTenantMetrics(tenantKey, options.limitMetrics || 20);
    const recommendations = [];

    for (const snapshot of metrics) {
      // eslint-disable-next-line no-await-in-loop
      const benchmark = await this.marketBenchmarkEngine.calculateBenchmark(tenantKey, snapshot.metric_key, options);
      if (benchmark?.ok === false) continue;

      const problemType = this._resolveProblemType(snapshot.metric_key, benchmark.status);
      if (!problemType) continue;

      // eslint-disable-next-line no-await-in-loop
      const playbooks = await this._listPlaybooks({
        vertical: options.vertical || benchmark.metadata?.vertical || 'global',
        problemType,
        limit: 3,
      });

      recommendations.push({
        metric_key: snapshot.metric_key,
        benchmark,
        problem_type: problemType,
        playbooks: playbooks.map((playbook) => this._sanitizePlaybook(playbook)),
        recommendation_type: benchmark.status === 'above_market' ? 'risk_mitigation' : 'opportunity_scaling',
      });
    }

    return recommendations;
  }

  async _listTenantMetrics(tenantKey, limit) {
    const SnapshotModel = TenantMetricSnapshot();
    const rows = await SnapshotModel.findAll({
      where: { tenant_key: String(tenantKey) },
      order: [['period_end', 'DESC'], ['created_at', 'DESC']],
      limit: Math.min(Math.max(Number(limit) || 20, 1), 50),
    });

    const seen = new Set();
    const uniqueRows = [];
    for (const row of rows || []) {
      const item = row.toJSON ? row.toJSON() : row;
      if (seen.has(item.metric_key)) continue;
      seen.add(item.metric_key);
      uniqueRows.push(item);
    }
    return uniqueRows;
  }

  async _listPlaybooks({ vertical, problemType, limit }) {
    const PlaybookModel = MarketPlaybook();
    const rows = await PlaybookModel.findAll({
      where: {
        vertical: String(vertical || 'global'),
        problem_type: String(problemType),
      },
      order: [['success_rate', 'DESC'], ['created_at', 'DESC']],
      limit: Math.min(Math.max(Number(limit) || 5, 1), 20),
    });

    let items = (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
    if (items.length === 0 && String(vertical || 'global') !== 'global') {
      const globalRows = await PlaybookModel.findAll({
        where: {
          vertical: 'global',
          problem_type: String(problemType),
        },
        order: [['success_rate', 'DESC'], ['created_at', 'DESC']],
        limit: Math.min(Math.max(Number(limit) || 5, 1), 20),
      });
      items = (globalRows || []).map((row) => (row.toJSON ? row.toJSON() : row));
    }

    return items;
  }

  _resolveProblemType(metricKey, status) {
    const key = String(metricKey || '').toLowerCase();

    if (LOWER_IS_BETTER_METRICS.has(key) && status === 'above_market') {
      if (key.includes('no_show')) return 'no_show';
      if (key.includes('cancel')) return 'cancellation';
      if (key.includes('churn')) return 'churn';
      return 'performance_risk';
    }

    if (!LOWER_IS_BETTER_METRICS.has(key) && status === 'below_market') {
      if (key.includes('conversion')) return 'conversion';
      if (key.includes('revenue')) return 'revenue';
      return 'growth_opportunity';
    }

    return null;
  }

  _sanitizePlaybook(item = {}) {
    return {
      id: item.id,
      vertical: item.vertical,
      problem_type: item.problem_type,
      playbook_name: item.playbook_name,
      description: item.description,
      success_rate: item.success_rate,
      metadata: {
        source: item?.metadata?.source || 'market_intelligence_layer',
      },
    };
  }
}

module.exports = {
  MarketRecommendationEngine,
};
