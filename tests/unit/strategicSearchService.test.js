'use strict';

const { StrategicSearchService } = require('../../api/core/tenant-intelligence/StrategicSearchService');

describe('StrategicSearchService', () => {
  function buildService() {
    const deps = {
      contextResolver: {
        resolve: jest.fn(async () => ({
          tenantId: 'tenant-1',
          period: { type: 'month', start: '2026-03-01T00:00:00.000Z', end: '2026-03-31T23:59:59.000Z' },
          tenantContext: { objetivo: 'Reduzir cancelamentos', ramo_atividade: 'Delivery' },
        })),
      },
      goalEngine: {
        listGoals: jest.fn(async () => ({
          items: [{ id: 'goal-1', metric_key: 'orders.cancel_rate', computed: { computedStatus: 'off_track' } }],
          total: 1,
        })),
      },
      metricEngine: {
        collectSnapshots: jest.fn(async () => ({
          ok: true,
          snapshots: [{ id: 'metric-1', metric_key: 'event_ledger.total_events', period_end: '2026-03-31T23:59:59.000Z' }],
        })),
        listSnapshots: jest.fn(async () => ({ items: [{ id: 'metric-1', metric_key: 'event_ledger.total_events' }], total: 1 })),
      },
      insightEngine: {
        generateInsights: jest.fn(async () => ({ ok: true, created: 1, insights: [{ id: 'insight-1' }] })),
        listInsights: jest.fn(async () => ({ items: [{ id: 'insight-1', type: 'goal_off_track', title: 'Meta fora do esperado' }], total: 1 })),
      },
      recommendationEngine: {
        generateRecommendations: jest.fn(async () => ({ ok: true, created: 1, recommendations: [{ id: 'reco-1' }] })),
        listRecommendations: jest.fn(async () => ({ items: [{ id: 'reco-1', insight_id: 'insight-1', goal_id: 'goal-1' }], total: 1 })),
      },
      rag: {
        queryRag: jest.fn(async () => ({ success: true, confidence: 0.88, response: 'Analise suportada por RAG', sources: [] })),
      },
      evidenceEngine: {
        listByInsight: jest.fn(async () => ({ items: [], total: 0 })),
      },
    };

    return {
      service: new StrategicSearchService(deps),
      deps,
    };
  }

  test('modo read (default) nao executa refresh com escrita', async () => {
    const { service, deps } = buildService();

    const out = await service.search({
      tenantId: 'tenant-1',
      question: 'por que os cancelamentos aumentaram este mes?',
      period: 'month',
      filters: {},
    });

    expect(out.ok).toBe(true);
    expect(typeof out.answer).toBe('string');
    expect(out.goalsImpact).toHaveLength(1);
    expect(out.goalsImpact[0]).toEqual(expect.objectContaining({ id: 'goal-1', metric_key: 'orders.cancel_rate', status: 'off_track' }));
    expect(out.insights).toHaveLength(1);
    expect(out.insights[0]).toEqual(expect.objectContaining({ id: 'insight-1', type: 'goal_off_track' }));
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0]).toEqual(expect.objectContaining({ id: 'reco-1', insight_id: 'insight-1', goal_id: 'goal-1' }));
    expect(out.meta).toEqual(expect.objectContaining({ mode: 'read', usedRag: true, usedSnapshots: false, usedPersistedInsights: true }));
    expect(Array.isArray(out.evidence)).toBe(true);
    expect(Array.isArray(out.sources)).toBe(true);
    expect(out.context.period).toBeDefined();

    expect(deps.metricEngine.collectSnapshots).not.toHaveBeenCalled();
    expect(deps.insightEngine.generateInsights).not.toHaveBeenCalled();
    expect(deps.recommendationEngine.generateRecommendations).not.toHaveBeenCalled();
  });

  test('modo refresh executa pipeline com escrita controlada e sem recolher snapshots duas vezes', async () => {
    const { service, deps } = buildService();

    const out = await service.search({
      tenantId: 'tenant-1',
      question: 'quero refresh completo',
      period: 'month',
      filters: {},
      options: {
        refreshMetrics: true,
        refreshInsights: true,
        refreshRecommendations: true,
      },
    });

    expect(out.ok).toBe(true);
    expect(out.meta).toEqual(expect.objectContaining({ usedRag: true, usedSnapshots: true, usedPersistedInsights: true }));
    expect(deps.metricEngine.collectSnapshots).toHaveBeenCalledTimes(1);
    expect(deps.insightEngine.generateInsights).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      snapshots: [{ id: 'metric-1', metric_key: 'event_ledger.total_events', period_end: '2026-03-31T23:59:59.000Z' }],
      refreshMetrics: false,
      persist: true,
    }));
    expect(deps.recommendationEngine.generateRecommendations).toHaveBeenCalledTimes(1);
  });

  test('refresh parcial de insights nao coleta metricas novas', async () => {
    const { service, deps } = buildService();

    await service.search({
      tenantId: 'tenant-1',
      question: 'refresh parcial',
      options: {
        refreshMetrics: false,
        refreshInsights: true,
        refreshRecommendations: false,
      },
    });

    expect(deps.metricEngine.collectSnapshots).not.toHaveBeenCalled();
    expect(deps.insightEngine.generateInsights).toHaveBeenCalledWith(expect.objectContaining({
      refreshMetrics: false,
      snapshots: [],
    }));
    expect(deps.recommendationEngine.generateRecommendations).not.toHaveBeenCalled();
  });
});
