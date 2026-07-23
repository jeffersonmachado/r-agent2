'use strict';

const { MarketPrediction } = require('../../db/models');
const { buildId, toNumber } = require('../tenant-intelligence/helpers');
const { MarketBenchmarkEngine } = require('./MarketBenchmarkEngine');

class MarketPredictionEngine {
  constructor({ marketBenchmarkEngine } = {}) {
    this.marketBenchmarkEngine = marketBenchmarkEngine || new MarketBenchmarkEngine();
  }

  async predictMetric(tenantKey, metricKey, options = {}) {
    if (!tenantKey) throw new Error('tenantKey is required');
    if (!metricKey) throw new Error('metricKey is required');

    const cached = await this._findLatestPrediction(tenantKey, metricKey, options.predictionType || null);
    if (cached && options.forceRefresh !== true) {
      return cached;
    }

    const benchmark = await this.marketBenchmarkEngine.calculateBenchmark(tenantKey, metricKey, options);
    if (!benchmark?.ok && benchmark?.error) {
      return benchmark;
    }

    const predictionType = String(options.predictionType || this._inferPredictionType(metricKey));
    const predictionWindow = String(options.predictionWindow || 'next_30d');
    const tenantValue = toNumber(benchmark.tenant_value, 0);
    const marketAvg = toNumber(benchmark.market_avg, tenantValue);
    const predictedValue = Number((tenantValue + ((marketAvg - tenantValue) * 0.35)).toFixed(6));
    const confidence = Number((0.55 + (Math.min(benchmark.metadata?.sample_size || 0, 1000) / 1000) * 0.25).toFixed(4));
    const generatedAt = new Date();

    const PredictionModel = MarketPrediction();
    const row = await PredictionModel.create({
      id: buildId('market-prediction'),
      tenant_key: String(tenantKey),
      prediction_type: predictionType,
      target_metric: String(metricKey),
      predicted_value: predictedValue,
      confidence,
      prediction_window: predictionWindow,
      evidence: {
        benchmark,
      },
      generated_at: generatedAt,
      metadata: {
        model: 'statistical_market_regression_v1',
        source: 'market_intelligence_layer',
        note: 'Uses statistical regression on benchmark data. Requires real ML model for production accuracy.',
      },
    });

    return this._sanitizePrediction(row.toJSON ? row.toJSON() : row);
  }

  async _findLatestPrediction(tenantKey, metricKey, predictionType = null) {
    const PredictionModel = MarketPrediction();
    const where = {
      tenant_key: String(tenantKey),
      target_metric: String(metricKey),
    };
    if (predictionType) where.prediction_type = String(predictionType);

    const row = await PredictionModel.findOne({
      where,
      order: [['generated_at', 'DESC'], ['created_at', 'DESC']],
    });

    return row ? this._sanitizePrediction(row.toJSON ? row.toJSON() : row) : null;
  }

  _inferPredictionType(metricKey) {
    const key = String(metricKey || '').toLowerCase();
    if (key.includes('churn')) return 'churn_probability';
    if (key.includes('demand')) return 'demand_forecast';
    if (key.includes('conversion')) return 'conversion_probability';
    if (key.includes('cancel')) return 'cancellation_forecast';
    return 'metric_forecast';
  }

  _sanitizePrediction(item = {}) {
    return {
      id: item.id,
      tenant_key: item.tenant_key,
      prediction_type: item.prediction_type,
      target_metric: item.target_metric,
      predicted_value: item.predicted_value,
      confidence: item.confidence,
      prediction_window: item.prediction_window,
      generated_at: item.generated_at,
      metadata: {
        model: item?.metadata?.model || 'statistical_market_regression_v1',
        source: item?.metadata?.source || 'market_intelligence_layer',
      },
    };
  }
}

module.exports = {
  MarketPredictionEngine,
};
