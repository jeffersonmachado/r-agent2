'use strict';

const mockMarketAggregateFindAll = jest.fn();
const mockMarketBenchmarkCreate = jest.fn();
const mockTenantMetricSnapshotFindOne = jest.fn();
const mockMarketPatternFindAll = jest.fn();
const mockMarketPredictionFindOne = jest.fn();
const mockMarketPredictionCreate = jest.fn();
const mockMarketPlaybookFindAll = jest.fn();
const mockTenantMetricSnapshotFindAll = jest.fn();

jest.mock('../../api/db/models/index.js', () => ({
  MarketMetricAggregate: jest.fn(() => ({ findAll: mockMarketAggregateFindAll })),
  MarketBenchmark: jest.fn(() => ({ create: mockMarketBenchmarkCreate })),
  TenantMetricSnapshot: jest.fn(() => ({
    findOne: mockTenantMetricSnapshotFindOne,
    findAll: mockTenantMetricSnapshotFindAll,
  })),
  MarketPattern: jest.fn(() => ({ findAll: mockMarketPatternFindAll })),
  MarketPrediction: jest.fn(() => ({ findOne: mockMarketPredictionFindOne, create: mockMarketPredictionCreate })),
  MarketPlaybook: jest.fn(() => ({ findAll: mockMarketPlaybookFindAll })),
}));

jest.mock('../../api/services/tenantService', () => ({
  getTenantContext: jest.fn(() => ({ ramo_atividade: 'beauty', metadata: { region: 'br' } })),
}));

function loadEngines() {
  return {
    MarketBenchmarkEngine: require('../../api/core/market-intelligence/MarketBenchmarkEngine').MarketBenchmarkEngine,
    MarketPatternEngine: require('../../api/core/market-intelligence/MarketPatternEngine').MarketPatternEngine,
    MarketPredictionEngine: require('../../api/core/market-intelligence/MarketPredictionEngine').MarketPredictionEngine,
    MarketRecommendationEngine: require('../../api/core/market-intelligence/MarketRecommendationEngine').MarketRecommendationEngine,
  };
}

describe('Market Intelligence engines', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const models = require('../../api/db/models/index.js');
    models.MarketMetricAggregate.mockImplementation(() => ({ findAll: mockMarketAggregateFindAll }));
    models.MarketBenchmark.mockImplementation(() => ({ create: mockMarketBenchmarkCreate }));
    models.TenantMetricSnapshot.mockImplementation(() => ({
      findOne: mockTenantMetricSnapshotFindOne,
      findAll: mockTenantMetricSnapshotFindAll,
    }));
    models.MarketPattern.mockImplementation(() => ({ findAll: mockMarketPatternFindAll }));
    models.MarketPrediction.mockImplementation(() => ({
      findOne: mockMarketPredictionFindOne,
      create: mockMarketPredictionCreate,
    }));
    models.MarketPlaybook.mockImplementation(() => ({ findAll: mockMarketPlaybookFindAll }));
  });

  test('MarketBenchmarkEngine calcula benchmark coerente e anonimizado', async () => {
    mockTenantMetricSnapshotFindOne.mockResolvedValue({
      toJSON: () => ({ metric_key: 'cancellation_rate', value: 0.24, period_end: '2026-03-31T00:00:00.000Z' }),
    });
    mockMarketAggregateFindAll.mockResolvedValue([{
      toJSON: () => ({
        vertical: 'beauty',
        region: 'br',
        avg_value: 0.17,
        median_value: 0.16,
        p90_value: 0.25,
        sample_size: 20,
        period_start: '2026-03-01T00:00:00.000Z',
        period_end: '2026-03-31T00:00:00.000Z',
      }),
    }]);
    mockMarketBenchmarkCreate.mockResolvedValue({});

    const { MarketBenchmarkEngine } = loadEngines();
    const engine = new MarketBenchmarkEngine();
    const result = await engine.calculateBenchmark('tenant-1', 'cancellation_rate');

    expect(result).toEqual(expect.objectContaining({
      metric: 'cancellation_rate',
      tenant_value: 0.24,
      market_avg: 0.17,
      market_median: 0.16,
      status: 'above_market',
    }));
    expect(result.metadata.sample_size).toBe(20);
  });

  test('MarketBenchmarkEngine bloqueia sample_size pequeno', async () => {
    mockTenantMetricSnapshotFindOne.mockResolvedValue({
      toJSON: () => ({ metric_key: 'cancellation_rate', value: 0.24, period_end: '2026-03-31T00:00:00.000Z' }),
    });
    mockMarketAggregateFindAll.mockResolvedValue([{
      toJSON: () => ({
        vertical: 'beauty',
        region: 'br',
        avg_value: 0.17,
        median_value: 0.16,
        p90_value: 0.25,
        sample_size: 3,
      }),
    }]);

    const { MarketBenchmarkEngine } = loadEngines();
    const engine = new MarketBenchmarkEngine();
    const result = await engine.calculateBenchmark('tenant-1', 'cancellation_rate');

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      error: 'insufficient_anonymized_sample',
    }));
    expect(mockMarketBenchmarkCreate).not.toHaveBeenCalled();
  });

  test('MarketPatternEngine retorna padroes sanitizados', async () => {
    mockMarketPatternFindAll.mockResolvedValue([{
      toJSON: () => ({
        id: 'pattern-1',
        vertical: 'beauty',
        pattern_type: 'churn_signal',
        description: 'clientes com duas faltas seguidas',
        confidence: 0.82,
        detected_at: '2026-03-14T12:00:00.000Z',
        metadata: { source: 'aggregate' },
        evidence: { shouldNotLeak: true },
      }),
    }]);

    const { MarketPatternEngine } = loadEngines();
    const engine = new MarketPatternEngine();
    const items = await engine.detectPatterns('beauty');

    expect(items[0]).toEqual({
      id: 'pattern-1',
      vertical: 'beauty',
      pattern_type: 'churn_signal',
      description: 'clientes com duas faltas seguidas',
      confidence: 0.82,
      detected_at: '2026-03-14T12:00:00.000Z',
      metadata: { source: 'aggregate' },
    });
    expect(items[0].evidence).toBeUndefined();
  });

  test('MarketPredictionEngine retorna estrutura estavel e explicavel', async () => {
    mockTenantMetricSnapshotFindOne.mockResolvedValue({
      toJSON: () => ({ metric_key: 'attendance_rate', value: 0.21, period_end: '2026-03-31T00:00:00.000Z' }),
    });
    mockMarketAggregateFindAll.mockResolvedValue([{
      toJSON: () => ({
        vertical: 'beauty',
        region: 'br',
        avg_value: 0.31,
        median_value: 0.29,
        p90_value: 0.40,
        sample_size: 20,
      }),
    }]);
    mockMarketBenchmarkCreate.mockResolvedValue({});
    mockMarketPredictionFindOne.mockResolvedValue(null);
    mockMarketPredictionCreate.mockResolvedValue({
      toJSON: () => ({
        id: 'pred-1',
        tenant_key: 'tenant-1',
        prediction_type: 'metric_forecast',
        target_metric: 'attendance_rate',
        predicted_value: 0.245,
        confidence: 0.555,
        prediction_window: 'next_30d',
        generated_at: '2026-03-14T12:00:00.000Z',
        metadata: { model: 'heuristic_market_regression_v1', source: 'market_intelligence_layer' },
        evidence: { hidden: true },
      }),
    });

    const { MarketPredictionEngine } = loadEngines();
    const engine = new MarketPredictionEngine();
    const result = await engine.predictMetric('tenant-1', 'attendance_rate');

    expect(result).toEqual(expect.objectContaining({
      prediction_type: 'metric_forecast',
      target_metric: 'attendance_rate',
      predicted_value: 0.245,
      confidence: 0.555,
    }));
    expect(result.evidence).toBeUndefined();
  });

  test('MarketRecommendationEngine gera recomendacoes coerentes', async () => {
    mockTenantMetricSnapshotFindAll.mockResolvedValue([
      { toJSON: () => ({ metric_key: 'no_show_rate', period_end: '2026-03-31T00:00:00.000Z' }) },
    ]);
    mockTenantMetricSnapshotFindOne.mockResolvedValue({
      toJSON: () => ({ metric_key: 'no_show_rate', value: 0.21, period_end: '2026-03-31T00:00:00.000Z' }),
    });
    mockMarketAggregateFindAll.mockResolvedValue([{
      toJSON: () => ({
        vertical: 'beauty',
        region: 'br',
        avg_value: 0.17,
        median_value: 0.16,
        p90_value: 0.23,
        sample_size: 20,
      }),
    }]);
    mockMarketBenchmarkCreate.mockResolvedValue({});
    mockMarketPlaybookFindAll.mockResolvedValue([{
      toJSON: () => ({
        id: 'playbook-1',
        vertical: 'beauty',
        problem_type: 'no_show',
        playbook_name: 'double_confirmation_flow',
        description: 'confirmacao em duas etapas',
        success_rate: 0.67,
      }),
    }]);

    const { MarketRecommendationEngine } = loadEngines();
    const engine = new MarketRecommendationEngine();
    const items = await engine.recommendActions('tenant-1', { vertical: 'beauty' });

    expect(items[0]).toEqual(expect.objectContaining({
      metric_key: 'no_show_rate',
      problem_type: 'no_show',
      recommendation_type: 'risk_mitigation',
    }));
    expect(items[0].playbooks[0]).toEqual(expect.objectContaining({
      playbook_name: 'double_confirmation_flow',
    }));
  });
});
