'use strict';

/**
 * timeSeriesModel — detecção de anomalia e projeção aprendidas da série
 * histórica de snapshots (regressão linear, sem threshold hardcoded).
 */

const {
  normalizeSeries,
  fitLinearTrend,
  detectAnomaly,
  projectToPeriodEnd,
} = require('../../api/core/tenant-intelligence/timeSeriesModel');

const DAY = 86400000;
const T0 = new Date('2026-09-01T00:00:00.000Z').getTime();

function seriesFromValues(values) {
  // Mais antigo → mais recente, 1 ponto por dia.
  return values.map((value, i) => ({
    id: `s${i}`,
    metric_key: 'm.test',
    value,
    period_end: new Date(T0 + i * DAY).toISOString(),
  }));
}

describe('timeSeriesModel.normalizeSeries', () => {
  test('ordena do mais antigo ao mais recente e ignora pontos inválidos', () => {
    const input = [
      { value: 30, period_end: new Date(T0 + 2 * DAY).toISOString() },
      { value: 10, period_end: new Date(T0).toISOString() },
      { value: 'abc', period_end: new Date(T0 + DAY).toISOString() },
      { value: 20, period_end: new Date(T0 + DAY).toISOString() },
    ];
    const points = normalizeSeries(input);
    expect(points.map((p) => p.y)).toEqual([10, 20, 30]);
  });
});

describe('timeSeriesModel.fitLinearTrend', () => {
  test('série perfeitamente linear tem slope exato e sigma zero', () => {
    const model = fitLinearTrend(normalizeSeries(seriesFromValues([100, 120, 140, 160, 180])));
    expect(model.slope).toBeCloseTo(20, 6);
    expect(model.sigma).toBeCloseTo(0, 6);
  });

  test('menos de 2 pontos retorna null', () => {
    expect(fitLinearTrend([{ x: T0, y: 1 }])).toBeNull();
  });
});

describe('timeSeriesModel.detectAnomaly', () => {
  test('histórico insuficiente (<4 pontos) retorna null (fallback externo)', () => {
    expect(detectAnomaly(seriesFromValues([100, 120, 140]))).toBeNull();
  });

  test('pico fora da banda aprendida é anomalia (direction up)', () => {
    const result = detectAnomaly(seriesFromValues([100, 100, 100, 100, 100, 150]));
    expect(result).not.toBeNull();
    expect(result.anomalous).toBe(true);
    expect(result.direction).toBe('up');
    expect(result.expected).toBe(100);
    expect(result.observed).toBe(150);
    expect(result.method).toBe('linear_regression');
    expect(result.changeRatio).toBeCloseTo(0.5, 6);
  });

  test('variação dentro da banda NÃO é anomalia', () => {
    const result = detectAnomaly(seriesFromValues([100, 100, 100, 100, 100, 110]));
    expect(result.anomalous).toBe(false);
  });

  test('crescimento exponencial sustentado NÃO é anomalia (threshold de 20% acusaria falso positivo)', () => {
    // +25%/dia consistente: o modelo aprende o trend e absorve; o threshold
    // fixo comparando apenas os 2 últimos pontos dispararia toda vez.
    const result = detectAnomaly(seriesFromValues([100, 125, 156, 195, 244, 305]));
    expect(result).not.toBeNull();
    expect(result.anomalous).toBe(false);
  });

  test('quebra de tendência (queda brusca em série crescente) é anomalia down', () => {
    const result = detectAnomaly(seriesFromValues([100, 120, 140, 160, 180, 90]));
    expect(result.anomalous).toBe(true);
    expect(result.direction).toBe('down');
  });
});

describe('timeSeriesModel.projectToPeriodEnd', () => {
  const periodEnd = new Date(T0 + 30 * DAY).toISOString();

  test('série crescente projeta valor maior com direction up', () => {
    const forecast = projectToPeriodEnd(seriesFromValues([100, 120, 140, 160, 180]), { periodEnd });
    expect(forecast).not.toBeNull();
    expect(forecast.projectedValue).toBeGreaterThan(180);
    expect(forecast.direction).toBe('up');
    expect(forecast.horizon).toBe('period_end');
  });

  test('série estável projeta direction flat', () => {
    const forecast = projectToPeriodEnd(seriesFromValues([100, 101, 99, 100, 100]), { periodEnd });
    expect(forecast).not.toBeNull();
    expect(forecast.direction).toBe('flat');
  });

  test('dados insuficientes ou fim de período já alcançado retornam null', () => {
    expect(projectToPeriodEnd(seriesFromValues([100, 110]), { periodEnd })).toBeNull();
    expect(projectToPeriodEnd(seriesFromValues([100, 110, 120]), { periodEnd: new Date(T0 + DAY).toISOString() })).toBeNull();
  });
});

describe('InsightEngine — detecção por modelo de série temporal', () => {
  function loadInsightEngine() {
    jest.resetModules();
    jest.doMock('../../api/db/models', () => ({
      TenantGoal: () => ({ findAll: jest.fn(async () => []) }),
      TenantInsight: () => ({ findOne: jest.fn(async () => null) }),
      TenantInsightEvidence: () => ({ create: jest.fn(async (data) => data) }),
      TenantMetricSnapshot: () => ({ findAll: jest.fn(async () => []) }),
    }));
    // eslint-disable-next-line global-require
    const { InsightEngine } = require('../../api/core/tenant-intelligence/InsightEngine');
    return new InsightEngine();
  }

  test('crescimento sustentado NÃO gera insight (modelo absorve o trend)', async () => {
    const engine = loadInsightEngine();
    const snapshots = [100, 125, 156, 195, 244, 305].map((value, i) => ({
      id: `s${i}`,
      metric_key: 'operations.tickets_total',
      value,
      period_end: new Date(T0 + i * DAY).toISOString(),
    }));

    const result = await engine.generateInsights({
      tenantId: 'tenant-1',
      snapshots,
      persist: false,
      refreshMetrics: false,
    });

    expect(result.ok).toBe(true);
    expect(result.insights).toHaveLength(0);
  });

  test('anomalia gera insight com metadata.anomaly (linear_regression) e forecast', async () => {
    const engine = loadInsightEngine();
    const snapshots = [100, 100, 100, 100, 100, 150].map((value, i) => ({
      id: `s${i}`,
      metric_key: 'operations.tickets_total',
      value,
      period_end: new Date(T0 + i * DAY).toISOString(),
    }));

    const result = await engine.generateInsights({
      tenantId: 'tenant-1',
      snapshots,
      persist: false,
      refreshMetrics: false,
    });

    expect(result.ok).toBe(true);
    expect(result.insights).toHaveLength(1);
    const insight = result.insights[0];
    expect(insight.type).toBe('metric_increase');
    expect(insight.metadata.anomaly).toBeDefined();
    expect(insight.metadata.anomaly.method).toBe('linear_regression');
    expect(insight.metadata.anomaly.anomalous).toBe(true);
    expect(insight.metadata.detectionMethod).toBeUndefined();
    expect(insight.metadata.forecast).toBeDefined();
    expect(insight.metadata.forecast.horizon).toBe('period_end');
    expect(insight.description).toContain('padrao esperado');
    expect(insight.description).toContain('Projecao para o fechamento do periodo');
  });

  test('histórico curto cai no fallback de threshold (detectionMethod explícito)', async () => {
    const engine = loadInsightEngine();
    const snapshots = [100, 150].map((value, i) => ({
      id: `s${i}`,
      metric_key: 'operations.tickets_total',
      value,
      period_end: new Date(T0 + i * DAY).toISOString(),
    }));

    const result = await engine.generateInsights({
      tenantId: 'tenant-1',
      snapshots,
      persist: false,
      refreshMetrics: false,
    });

    expect(result.ok).toBe(true);
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].metadata.detectionMethod).toBe('threshold_fallback');
    expect(result.insights[0].metadata.anomaly).toBeUndefined();
  });
});
