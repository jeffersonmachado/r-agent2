'use strict';

const { TenantOperationalStateEngine } = require('../../api/core/tenant-intelligence/TenantOperationalStateEngine');

describe('TenantOperationalStateEngine', () => {
  function buildEngine() {
    const deps = {
      contextResolver: {
        resolve: jest.fn(async () => ({
          tenantId: 'tenant-1',
          period: {
            type: 'month',
            start: '2026-03-01T00:00:00.000Z',
            end: '2026-03-31T23:59:59.000Z',
          },
          tenantContext: {
            objetivo: 'Aumentar eficiencia operacional',
            ramo_atividade: 'SaaS',
          },
        })),
      },
      goalEngine: {
        listGoals: jest.fn(async () => ({
          items: [
            { id: 'goal-1', computed: { computedStatus: 'off_track' } },
            { id: 'goal-2', computed: { computedStatus: 'at_risk' } },
          ],
          total: 2,
        })),
      },
      metricEngine: {
        collectSnapshots: jest.fn(async () => ({
          ok: true,
          snapshots: [{ id: 'snap-1', metric_key: 'event_ledger.total_events' }],
        })),
        listSnapshots: jest.fn(async () => ({
          items: [
            {
              id: 'metric-1',
              metric_key: 'event_ledger.total_events',
              period_end: '2026-03-31T23:59:59.000Z',
            },
          ],
          total: 1,
        })),
      },
      insightEngine: {
        listInsights: jest.fn(async () => ({
          items: [
            { id: 'ins-1', impact: 'high' },
            { id: 'ins-2', impact: 'medium' },
          ],
          total: 2,
        })),
      },
      recommendationEngine: {
        listRecommendations: jest.fn(async () => ({
          items: [
            { id: 'rec-1', priority: 'critical' },
            { id: 'rec-2', priority: 'high' },
          ],
          total: 2,
        })),
      },
      evidenceEngine: {
        listByInsight: jest.fn(async () => ({
          items: [{ id: 'ev-1', source_type: 'tenant_metric_snapshot' }],
          total: 1,
        })),
      },
      marketKnowledgeService: {
        getOperationalSignals: jest.fn(async () => ({
          ok: true,
          vertical: 'beauty',
          benchmarks: [
            {
              metricKey: 'cancellation_rate',
              tenantValue: 0.24,
              marketAvg: 0.17,
              marketMedian: 0.16,
              percentile: 82,
              status: 'above_market',
            },
            {
              metricKey: 'conversion_rate',
              tenantValue: 0.11,
              marketAvg: 0.18,
              marketMedian: 0.17,
              percentile: 22,
              status: 'below_market',
            },
          ],
          patterns: [
            { patternType: 'churn_signal', description: 'padrao agregado', confidence: 0.82 },
          ],
          playbooks: [
            { playbookName: 'double_confirmation_flow', problemType: 'no_show' },
          ],
          recommendations: [
            { recommendation_type: 'risk_mitigation', metric_key: 'cancellation_rate', problem_type: 'cancellation', playbooks: [{ id: 'p1' }] },
          ],
        })),
      },
    };

    return {
      deps,
      engine: new TenantOperationalStateEngine(deps),
    };
  }

  test('retorna estado operacional em modo read sem refresh de metricas', async () => {
    const { engine, deps } = buildEngine();

    const out = await engine.getOperationalState({
      tenantId: 'tenant-1',
      period: 'month',
      filters: {},
      options: { refreshMetrics: false },
    });

    expect(out.ok).toBe(true);
    expect(out.state).toBeDefined();
    expect(out.state.health).toEqual(expect.objectContaining({ status: 'critical' }));
    expect(out.state.goals.total).toBe(2);
    expect(out.state.metrics.totalSnapshots).toBe(1);
    expect(out.state.insights.totalOpen).toBe(2);
    expect(out.state.recommendations.totalOpen).toBe(2);
    expect(out.state.refresh).toEqual(expect.objectContaining({
      metrics: false,
      snapshotsCreated: 0,
    }));
    expect(deps.metricEngine.collectSnapshots).not.toHaveBeenCalled();
  });

  test('modo refresh coleta snapshots e atualiza refresh.snapshotsCreated', async () => {
    const { engine, deps } = buildEngine();

    const out = await engine.getOperationalState({
      tenantId: 'tenant-1',
      options: { refreshMetrics: true },
    });

    expect(out.ok).toBe(true);
    expect(deps.metricEngine.collectSnapshots).toHaveBeenCalledTimes(1);
    expect(out.state.refresh).toEqual(expect.objectContaining({
      metrics: true,
      snapshotsCreated: 1,
    }));
  });

  test('includeEvidence=true agrega evidenceByInsight', async () => {
    const { engine, deps } = buildEngine();

    const out = await engine.getOperationalState({
      tenantId: 'tenant-1',
      options: {
        includeEvidence: true,
      },
    });

    expect(out.ok).toBe(true);
    expect(deps.evidenceEngine.listByInsight).toHaveBeenCalled();
    expect(out.state.insights.evidenceTotal).toBeGreaterThan(0);
    expect(out.state.insights.evidenceByInsight).toEqual(expect.objectContaining({
      'ins-1': expect.any(Array),
      'ins-2': expect.any(Array),
    }));
  });

  test('integra sinais de mercado sem quebrar o estado operacional', async () => {
    const { engine } = buildEngine();

    const out = await engine.getOperationalState({
      tenantId: 'tenant-1',
      options: { refreshMetrics: false },
    });

    expect(out.ok).toBe(true);
    expect(out.state.market).toEqual(expect.objectContaining({
      ok: true,
      vertical: 'beauty',
    }));
    expect(out.state.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'above_market_cancellation_rate' }),
    ]));
    expect(out.state.opportunities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'below_market_conversion_rate' }),
    ]));
    expect(out.state.priorities).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'risk_mitigation' }),
    ]));
  });
});
