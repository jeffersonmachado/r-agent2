'use strict';

const tenantService = require('../../services/tenantService');
const { TenantMetricSnapshot, MarketPlaybook } = require('../../db/models');
const { MarketBenchmarkEngine } = require('./MarketBenchmarkEngine');
const { MarketPatternEngine } = require('./MarketPatternEngine');
const { MarketPredictionEngine } = require('./MarketPredictionEngine');
const { MarketRecommendationEngine } = require('./MarketRecommendationEngine');

class MarketKnowledgeService {
  constructor(deps = {}) {
    this.marketBenchmarkEngine = deps.marketBenchmarkEngine || new MarketBenchmarkEngine();
    this.marketPatternEngine = deps.marketPatternEngine || new MarketPatternEngine();
    this.marketPredictionEngine = deps.marketPredictionEngine || new MarketPredictionEngine({
      marketBenchmarkEngine: this.marketBenchmarkEngine,
    });
    this.marketRecommendationEngine = deps.marketRecommendationEngine || new MarketRecommendationEngine({
      marketBenchmarkEngine: this.marketBenchmarkEngine,
    });
  }

  async getBenchmarks(tenantKey, options = {}) {
    if (!tenantKey) throw new Error('tenantKey is required');
    const metricKeys = await this._resolveMetricKeys(tenantKey, options.metricKeys);
    const items = [];

    for (const metricKey of metricKeys) {
      // eslint-disable-next-line no-await-in-loop
      const benchmark = await this.marketBenchmarkEngine.calculateBenchmark(tenantKey, metricKey, options);
      if (benchmark?.ok === false) continue;
      items.push(benchmark);
    }

    return {
      ok: true,
      tenant_key: String(tenantKey),
      items: items.map((item) => this._serializeBenchmark(item)),
      total: items.length,
    };
  }

  async getMarketPatterns(vertical, options = {}) {
    const effectiveVertical = String(vertical || options.vertical || 'global');
    const items = await this.marketPatternEngine.detectPatterns(effectiveVertical, options);
    return {
      ok: true,
      vertical: effectiveVertical,
      items: items.map((item) => this._serializePattern(item)),
      total: items.length,
    };
  }

  async getPredictions(tenantKey, options = {}) {
    if (!tenantKey) throw new Error('tenantKey is required');
    const metricKeys = await this._resolveMetricKeys(tenantKey, options.metricKeys);
    const items = [];

    for (const metricKey of metricKeys) {
      // eslint-disable-next-line no-await-in-loop
      const prediction = await this.marketPredictionEngine.predictMetric(tenantKey, metricKey, options);
      if (prediction?.ok === false) continue;
      items.push(prediction);
    }

    return {
      ok: true,
      tenant_key: String(tenantKey),
      items: items.map((item) => this._serializePrediction(item)),
      total: items.length,
    };
  }

  async getMarketPlaybooks(vertical, options = {}) {
    const effectiveVertical = String(vertical || options.vertical || 'global');
    const PlaybookModel = MarketPlaybook();
    const rows = await PlaybookModel.findAll({
      where: {
        vertical: effectiveVertical,
        ...(options.problemType ? { problem_type: String(options.problemType) } : {}),
      },
      order: [['success_rate', 'DESC'], ['created_at', 'DESC']],
      limit: Math.min(Math.max(Number(options.limit) || 50, 1), 200),
    });

    let items = (rows || []).map((row) => (row.toJSON ? row.toJSON() : row));
    if (items.length === 0 && effectiveVertical !== 'global') {
      const globalRows = await PlaybookModel.findAll({
        where: {
          vertical: 'global',
          ...(options.problemType ? { problem_type: String(options.problemType) } : {}),
        },
        order: [['success_rate', 'DESC'], ['created_at', 'DESC']],
        limit: Math.min(Math.max(Number(options.limit) || 50, 1), 200),
      });
      items = (globalRows || []).map((row) => (row.toJSON ? row.toJSON() : row));
    }
    return {
      ok: true,
      vertical: effectiveVertical,
      items: items.map((item) => this._serializePlaybook(item)),
      total: items.length,
    };
  }

  async getOperationalSignals(tenantKey, options = {}) {
    if (!tenantKey) throw new Error('tenantKey is required');
    const tenantContext = tenantService.getTenantContext(String(tenantKey)) || {};
    const vertical = options.vertical || tenantContext?.ramo_atividade || 'global';
    const [benchmarksResult, patternsResult, playbooksResult, recommendations] = await Promise.all([
      this.getBenchmarks(tenantKey, options),
      this.getMarketPatterns(vertical, { limit: 10 }),
      this.getMarketPlaybooks(vertical, { limit: 10 }),
      this.marketRecommendationEngine.recommendActions(tenantKey, { ...options, vertical }),
    ]);

    return {
      ok: true,
      vertical: String(vertical),
      benchmarks: benchmarksResult.items || [],
      patterns: patternsResult.items || [],
      playbooks: playbooksResult.items || [],
      recommendations,
    };
  }

  async _resolveMetricKeys(tenantKey, metricKeysInput) {
    const explicit = Array.isArray(metricKeysInput)
      ? metricKeysInput.map((item) => String(item)).filter(Boolean)
      : [];
    if (explicit.length > 0) return explicit;

    const SnapshotModel = TenantMetricSnapshot();
    const rows = await SnapshotModel.findAll({
      where: { tenant_key: String(tenantKey) },
      attributes: ['metric_key'],
      order: [['period_end', 'DESC'], ['created_at', 'DESC']],
      limit: 50,
    });

    const metricKeys = [];
    const seen = new Set();
    for (const row of rows || []) {
      const item = row.toJSON ? row.toJSON() : row;
      const metricKey = String(item.metric_key || '');
      if (!metricKey || seen.has(metricKey)) continue;
      seen.add(metricKey);
      metricKeys.push(metricKey);
      if (metricKeys.length >= 10) break;
    }
    return metricKeys;
  }

  _serializeBenchmark(item = {}) {
    return {
      metricKey: item.metric,
      tenantValue: item.tenant_value,
      marketAvg: item.market_avg,
      marketMedian: item.market_median,
      percentile: item.percentile,
      status: item.status,
      evaluatedAt: item.evaluated_at,
    };
  }

  _serializePattern(item = {}) {
    return {
      vertical: item.vertical,
      patternType: item.pattern_type,
      description: item.description,
      confidence: item.confidence,
      detectedAt: item.detected_at,
    };
  }

  _serializePrediction(item = {}) {
    return {
      predictionType: item.prediction_type,
      targetMetric: item.target_metric,
      predictedValue: item.predicted_value,
      confidence: item.confidence,
      predictionWindow: item.prediction_window,
      generatedAt: item.generated_at,
    };
  }

  _serializePlaybook(item = {}) {
    return {
      vertical: item.vertical,
      problemType: item.problem_type,
      playbookName: item.playbook_name,
      description: item.description,
      successRate: item.success_rate,
    };
  }
}

let singleton = null;

function getMarketKnowledgeService() {
  if (!singleton) {
    singleton = new MarketKnowledgeService();
  }
  return singleton;
}

module.exports = {
  MarketKnowledgeService,
  getMarketKnowledgeService,
};
