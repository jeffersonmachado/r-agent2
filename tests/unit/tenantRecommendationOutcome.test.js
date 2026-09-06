'use strict';

/**
 * Tenant Intelligence — loop Recommendation -> Action -> Outcome
 * Unit tests com DB mockado (mesmo padrao de tenantIntelligenceEngines.test.js).
 */

function buildRecommendationModel(store) {
  return {
    create: jest.fn(async (data) => {
      const record = { status: 'open', estimated_impact: {}, metadata: {}, ...data };
      store.push(record);
      return { toJSON: () => record };
    }),
    findOne: jest.fn(async ({ where } = {}) => {
      const found = store.find((item) => {
        if (where?.id && item.id !== where.id) return false;
        if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
        return true;
      });
      if (!found) return null;
      return {
        toJSON: () => found,
        update: jest.fn(async (patch) => {
          Object.assign(found, patch);
          return found;
        }),
      };
    }),
    findAll: jest.fn(async ({ where } = {}) => store
      .filter((item) => {
        if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
        if (where?.status && item.status !== where.status) return false;
        return true;
      })
      .map((item) => ({
        toJSON: () => item,
        update: jest.fn(async (patch) => {
          Object.assign(item, patch);
          return item;
        }),
      }))),
  };
}

function buildInsightModel(store) {
  return {
    findOne: jest.fn(async ({ where } = {}) => {
      const found = store.find((item) => {
        if (where?.id && item.id !== where.id) return false;
        if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
        return true;
      });
      return found ? { toJSON: () => found } : null;
    }),
  };
}

function buildSnapshotModel(store) {
  return {
    findOne: jest.fn(async ({ where } = {}) => {
      const matches = store.filter((item) => {
        if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
        if (where?.metric_key && item.metric_key !== where.metric_key) return false;
        return true;
      });
      if (!matches.length) return null;
      const sorted = [...matches].sort((a, b) => {
        const byPeriod = new Date(b.period_end).getTime() - new Date(a.period_end).getTime();
        if (byPeriod !== 0) return byPeriod;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      const found = sorted[0];
      return { toJSON: () => found };
    }),
  };
}

function loadEngine({ recommendations = [], insights = [], snapshots = [] } = {}) {
  jest.resetModules();
  const recommendationModel = buildRecommendationModel(recommendations);
  const insightModel = buildInsightModel(insights);
  const snapshotModel = buildSnapshotModel(snapshots);
  const workspaceOperations = { createTask: jest.fn(async () => ({ id: 'task-1' })) };
  const evidenceEngine = { createEvidence: jest.fn(async (payload) => payload) };
  jest.doMock('../../api/db/models', () => ({
    TenantRecommendation: () => recommendationModel,
    TenantInsight: () => insightModel,
    TenantMetricSnapshot: () => snapshotModel,
  }));
  // eslint-disable-next-line global-require
  const { RecommendationEngine } = require('../../api/core/tenant-intelligence/RecommendationEngine');
  return {
    engine: new RecommendationEngine({ workspaceOperations, evidenceEngine }),
    recommendationModel,
    insightModel,
    snapshotModel,
    workspaceOperations,
    evidenceEngine,
  };
}

function buildRecommendation(overrides = {}) {
  return {
    id: 'reco-1',
    tenant_key: 'tenant-a',
    insight_id: null,
    goal_id: null,
    title: 'Titulo',
    description: 'Descricao',
    action_type: 'investigate_metric_drop',
    priority: 'medium',
    status: 'open',
    estimated_impact: {},
    metadata: {},
    ...overrides,
  };
}

function buildSnapshot(overrides = {}) {
  return {
    id: 'snap-1',
    tenant_key: 'tenant-a',
    metric_key: 'operations.tickets_open',
    value: 100,
    period_start: '2026-08-01T00:00:00.000Z',
    period_end: '2026-08-31T00:00:00.000Z',
    created_at: '2026-08-31T00:00:00.000Z',
    ...overrides,
  };
}

describe('RecommendationEngine.applyRecommendation', () => {
  test('aplica recomendacao aberta capturando baseline do insight relacionado', async () => {
    const recommendations = [buildRecommendation({
      insight_id: 'ins-1',
      metadata: { sourceInsightType: 'metric_drop', relatedMetrics: [] },
    })];
    const insights = [{
      id: 'ins-1',
      tenant_key: 'tenant-a',
      related_metrics: ['operations.tickets_open'],
    }];
    const snapshots = [buildSnapshot({ id: 'snap-base', value: 100 })];
    const { engine } = loadEngine({ recommendations, insights, snapshots });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'admin-user',
    });

    expect(result.ok).toBe(true);
    expect(result.recommendation.status).toBe('applied');
    const application = result.recommendation.metadata.application;
    expect(application.appliedBy).toBe('admin-user');
    expect(application.expectedDirection).toBe('up');
    expect(application.baseline).toHaveLength(1);
    expect(application.baseline[0].metricKey).toBe('operations.tickets_open');
    expect(application.baseline[0].value).toBe(100);
    expect(application.baseline[0].snapshotId).toBe('snap-base');
    expect(typeof application.appliedAt).toBe('string');
  });

  test.each([
    ['metric_drop', 'up'],
    ['goal_off_track', 'up'],
    ['goal_at_risk', 'up'],
    ['metric_increase', 'observe'],
    ['event_concentration', 'down'],
    ['tipo_desconhecido', 'observe'],
  ])('expectedDirection de %s eh %s', async (sourceInsightType, expectedDirection) => {
    const recommendations = [buildRecommendation({
      metadata: { sourceInsightType, relatedMetrics: ['operations.tickets_open'] },
    })];
    const { engine } = loadEngine({ recommendations });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: null,
    });

    expect(result.recommendation.metadata.application.expectedDirection).toBe(expectedDirection);
  });

  test('sem insight_id usa metadata.relatedMetrics como baseline', async () => {
    const recommendations = [buildRecommendation({
      metadata: { sourceInsightType: 'metric_drop', relatedMetrics: ['operations.abandonment_rate_pct'] },
    })];
    const snapshots = [buildSnapshot({
      id: 'snap-ab',
      metric_key: 'operations.abandonment_rate_pct',
      value: 12.5,
    })];
    const { engine } = loadEngine({ recommendations, snapshots });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
    });

    const baseline = result.recommendation.metadata.application.baseline;
    expect(baseline).toHaveLength(1);
    expect(baseline[0].metricKey).toBe('operations.abandonment_rate_pct');
    expect(baseline[0].value).toBe(12.5);
    expect(baseline[0].snapshotId).toBe('snap-ab');
  });

  test('retorna 404 recommendation_not_found para id inexistente', async () => {
    const { engine } = loadEngine({ recommendations: [buildRecommendation()] });
    await expect(engine.applyRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-x' }))
      .rejects.toMatchObject({ code: 'recommendation_not_found', statusCode: 404 });
  });

  test('retorna 404 cross-tenant (recomendacao de outro tenant)', async () => {
    const { engine } = loadEngine({ recommendations: [buildRecommendation()] });
    await expect(engine.applyRecommendation({ tenantId: 'tenant-b', recommendationId: 'reco-1' }))
      .rejects.toMatchObject({ code: 'recommendation_not_found', statusCode: 404 });
  });

  test('retorna 409 recommendation_not_open quando ja aplicada', async () => {
    const { engine } = loadEngine({
      recommendations: [buildRecommendation({ status: 'applied' })],
    });
    await expect(engine.applyRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-1' }))
      .rejects.toMatchObject({ code: 'recommendation_not_open', statusCode: 409 });
  });

  test('lanca erro sem tenantId/recommendationId', async () => {
    const { engine } = loadEngine();
    await expect(engine.applyRecommendation({ recommendationId: 'reco-1' }))
      .rejects.toThrow('tenantId is required');
    await expect(engine.applyRecommendation({ tenantId: 'tenant-a' }))
      .rejects.toThrow('recommendationId is required');
  });
});

describe('RecommendationEngine.dismissRecommendation', () => {
  test('descarta recomendacao aberta com reason', async () => {
    const { engine } = loadEngine({ recommendations: [buildRecommendation()] });

    const result = await engine.dismissRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'manager-1',
      reason: 'Nao aplicavel ao periodo',
    });

    expect(result.ok).toBe(true);
    expect(result.recommendation.status).toBe('dismissed');
    expect(result.recommendation.metadata.dismissal.dismissedBy).toBe('manager-1');
    expect(result.recommendation.metadata.dismissal.reason).toBe('Nao aplicavel ao periodo');
  });

  test('retorna 409 recommendation_not_open quando ja descartada', async () => {
    const { engine } = loadEngine({
      recommendations: [buildRecommendation({ status: 'dismissed' })],
    });
    await expect(engine.dismissRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-1' }))
      .rejects.toMatchObject({ code: 'recommendation_not_open', statusCode: 409 });
  });

  test('retorna 404 recommendation_not_found cross-tenant', async () => {
    const { engine } = loadEngine({ recommendations: [buildRecommendation()] });
    await expect(engine.dismissRecommendation({ tenantId: 'tenant-b', recommendationId: 'reco-1' }))
      .rejects.toMatchObject({ code: 'recommendation_not_found', statusCode: 404 });
  });
});

describe('RecommendationEngine.evaluateOutcome', () => {
  const futureIso = () => new Date(Date.now() + 60 * 1000).toISOString();

  async function applyAndAddSnapshot({
    sourceInsightType = 'metric_drop',
    baselineValue = 100,
    newValue = null,
    relatedMetrics = ['operations.tickets_open'],
  } = {}) {
    const metricKey = relatedMetrics[0];
    const recommendations = [buildRecommendation({
      metadata: { sourceInsightType, relatedMetrics },
    })];
    const snapshots = [buildSnapshot({
      id: 'snap-base',
      metric_key: metricKey,
      value: baselineValue,
    })];
    const { engine, snapshotModel } = loadEngine({ recommendations, snapshots });

    await engine.applyRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-1', actor: 'x' });

    if (newValue != null) {
      snapshots.push(buildSnapshot({
        id: 'snap-new',
        metric_key: metricKey,
        value: newValue,
        period_start: '2026-09-01T00:00:00.000Z',
        period_end: futureIso(),
        created_at: futureIso(),
      }));
    }

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });
    return { result, engine, snapshotModel };
  }

  test('improved quando metrica sobe com direction up', async () => {
    const { result } = await applyAndAddSnapshot({ baselineValue: 100, newValue: 110 });
    expect(result.recommendation.status).toBe('completed');
    expect(result.outcome.outcome).toBe('improved');
    expect(result.outcome.metrics[0].assessment).toBe('improved');
    expect(result.outcome.metrics[0].baselineValue).toBe(100);
    expect(result.outcome.metrics[0].currentValue).toBe(110);
    expect(result.outcome.metrics[0].delta).toBe(10);
    expect(result.outcome.metrics[0].deltaPct).toBeCloseTo(0.1);
    expect(result.outcome.metrics[0].snapshotId).toBe('snap-new');
  });

  test('regressed quando metrica cai com direction up', async () => {
    const { result } = await applyAndAddSnapshot({ baselineValue: 100, newValue: 90 });
    expect(result.outcome.outcome).toBe('regressed');
    expect(result.outcome.metrics[0].assessment).toBe('regressed');
  });

  test('unchanged quando variacao abaixo de 5%', async () => {
    const { result } = await applyAndAddSnapshot({ baselineValue: 100, newValue: 102 });
    expect(result.outcome.outcome).toBe('unchanged');
    expect(result.outcome.metrics[0].assessment).toBe('unchanged');
  });

  test('pending quando nao existe snapshot novo (mantem applied para reavaliacao)', async () => {
    const { result } = await applyAndAddSnapshot({ baselineValue: 100, newValue: null });
    expect(result.recommendation.status).toBe('applied');
    expect(result.outcome.outcome).toBe('pending');
    expect(result.outcome.metrics[0].assessment).toBe('pending');
    expect(result.outcome.metrics[0].currentValue).toBeNull();
  });

  test('reavalia apos snapshot novo: pending mantem applied e depois completa', async () => {
    const metricKey = 'operations.tickets_open';
    const recommendations = [buildRecommendation({
      metadata: { sourceInsightType: 'metric_drop', relatedMetrics: [metricKey] },
    })];
    const snapshots = [buildSnapshot({ id: 'snap-base', metric_key: metricKey, value: 100 })];
    const { engine } = loadEngine({ recommendations, snapshots });

    await engine.applyRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-1', actor: 'x' });

    const first = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });
    expect(first.outcome.outcome).toBe('pending');
    expect(first.recommendation.status).toBe('applied');

    snapshots.push(buildSnapshot({
      id: 'snap-new',
      metric_key: metricKey,
      value: 120,
      period_start: '2026-09-01T00:00:00.000Z',
      period_end: futureIso(),
      created_at: futureIso(),
    }));

    const second = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });
    expect(second.outcome.outcome).toBe('improved');
    expect(second.recommendation.status).toBe('completed');
  });

  test('direction down (event_concentration): queda da metrica eh improved', async () => {
    const { result } = await applyAndAddSnapshot({
      sourceInsightType: 'event_concentration',
      baselineValue: 100,
      newValue: 80,
    });
    expect(result.outcome.outcome).toBe('improved');
    expect(result.outcome.metrics[0].assessment).toBe('improved');
  });

  test('direction observe (metric_increase): variacao >=5% eh changed', async () => {
    const { result } = await applyAndAddSnapshot({
      sourceInsightType: 'metric_increase',
      baselineValue: 100,
      newValue: 130,
    });
    expect(result.outcome.metrics[0].assessment).toBe('changed');
    expect(result.outcome.outcome).toBe('unchanged');
  });

  test('direction observe (metric_increase): variacao <5% eh stable', async () => {
    const { result } = await applyAndAddSnapshot({
      sourceInsightType: 'metric_increase',
      baselineValue: 100,
      newValue: 103,
    });
    expect(result.outcome.metrics[0].assessment).toBe('stable');
    expect(result.outcome.outcome).toBe('unchanged');
  });

  test('baseline zerada com direction up: valor positivo eh improved', async () => {
    const { result } = await applyAndAddSnapshot({ baselineValue: 0, newValue: 10 });
    expect(result.outcome.metrics[0].deltaPct).toBeNull();
    expect(result.outcome.metrics[0].assessment).toBe('improved');
    expect(result.outcome.outcome).toBe('improved');
  });

  test('sem baseline gravado: pending com reason no_baseline_metrics', async () => {
    const recommendations = [buildRecommendation({
      status: 'applied',
      metadata: {
        sourceInsightType: 'metric_drop',
        application: {
          appliedAt: new Date().toISOString(),
          appliedBy: 'x',
          baseline: [],
          expectedDirection: 'up',
        },
      },
    })];
    const { engine } = loadEngine({ recommendations });

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });
    expect(result.recommendation.status).toBe('completed');
    expect(result.outcome.outcome).toBe('pending');
    expect(result.outcome.reason).toBe('no_baseline_metrics');
    expect(result.outcome.metrics).toEqual([]);
  });

  test('retorna 409 recommendation_not_applied quando status nao eh applied', async () => {
    const { engine } = loadEngine({ recommendations: [buildRecommendation({ status: 'open' })] });
    await expect(engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' }))
      .rejects.toMatchObject({ code: 'recommendation_not_applied', statusCode: 409 });
  });

  test('retorna 404 recommendation_not_found cross-tenant', async () => {
    const { engine } = loadEngine({ recommendations: [buildRecommendation({ status: 'applied' })] });
    await expect(engine.evaluateOutcome({ tenantId: 'tenant-b', recommendationId: 'reco-1' }))
      .rejects.toMatchObject({ code: 'recommendation_not_found', statusCode: 404 });
  });
});

describe('RecommendationEngine.evaluatePendingOutcomes (hook event-driven)', () => {
  const futureIso = () => new Date(Date.now() + 60 * 1000).toISOString();

  function buildAppliedRecommendation(overrides = {}) {
    return buildRecommendation({
      status: 'applied',
      metadata: {
        sourceInsightType: 'metric_drop',
        application: {
          appliedAt: new Date().toISOString(),
          appliedBy: 'manager-1',
          baseline: [{ metricKey: 'operations.tickets_open', value: 100, snapshotId: 'snap-base', capturedAt: new Date().toISOString() }],
          expectedDirection: 'up',
        },
      },
      ...overrides,
    });
  }

  test('sem recomendacoes aplicadas: total 0', async () => {
    const { engine } = loadEngine({ recommendations: [buildRecommendation({ status: 'open' })] });
    const result = await engine.evaluatePendingOutcomes({ tenantId: 'tenant-a' });
    expect(result).toMatchObject({ ok: true, total: 0, evaluated: 0, pending: 0, results: [] });
  });

  test('sem snapshot novo: recomendacao permanece applied (pending)', async () => {
    const recommendations = [buildAppliedRecommendation()];
    const snapshots = [buildSnapshot({ id: 'snap-base', value: 100 })];
    const { engine } = loadEngine({ recommendations, snapshots });

    const result = await engine.evaluatePendingOutcomes({ tenantId: 'tenant-a' });

    expect(result).toMatchObject({ total: 1, evaluated: 0, pending: 1 });
    expect(result.results[0]).toEqual({ recommendationId: 'reco-1', outcome: 'pending' });
    expect(recommendations[0].status).toBe('applied');
  });

  test('com snapshot novo: avalia e completa a recomendacao', async () => {
    const recommendations = [buildAppliedRecommendation()];
    const snapshots = [
      buildSnapshot({ id: 'snap-base', value: 100 }),
      buildSnapshot({ id: 'snap-new', value: 130, period_end: futureIso(), created_at: futureIso() }),
    ];
    const { engine } = loadEngine({ recommendations, snapshots });

    const result = await engine.evaluatePendingOutcomes({ tenantId: 'tenant-a' });

    expect(result).toMatchObject({ total: 1, evaluated: 1, pending: 0 });
    expect(result.results[0]).toEqual({ recommendationId: 'reco-1', outcome: 'improved' });
    expect(recommendations[0].status).toBe('completed');
    expect(recommendations[0].metadata.outcome.outcome).toBe('improved');
  });

  test('misto: avalia so quem tem snapshot novo', async () => {
    const recommendations = [
      buildAppliedRecommendation(),
      buildAppliedRecommendation({
        id: 'reco-2',
        metadata: {
          sourceInsightType: 'metric_drop',
          application: {
            appliedAt: new Date().toISOString(),
            appliedBy: 'manager-1',
            baseline: [{ metricKey: 'operations.abandonment_rate_pct', value: 50, snapshotId: 'snap-b2', capturedAt: new Date().toISOString() }],
            expectedDirection: 'up',
          },
        },
      }),
    ];
    const snapshots = [
      buildSnapshot({ id: 'snap-base', metric_key: 'operations.tickets_open', value: 100 }),
      buildSnapshot({ id: 'snap-new', metric_key: 'operations.tickets_open', value: 90, period_end: futureIso(), created_at: futureIso() }),
      buildSnapshot({ id: 'snap-b2', metric_key: 'operations.abandonment_rate_pct', value: 50 }),
    ];
    const { engine } = loadEngine({ recommendations, snapshots });

    const result = await engine.evaluatePendingOutcomes({ tenantId: 'tenant-a' });

    expect(result).toMatchObject({ total: 2, evaluated: 1, pending: 1 });
    expect(recommendations[0].status).toBe('completed');
    expect(recommendations[1].status).toBe('applied');
  });

  test('isolamento de tenant: nao avalia recomendacoes de outro tenant', async () => {
    const recommendations = [buildAppliedRecommendation({ tenant_key: 'tenant-b' })];
    const { engine } = loadEngine({ recommendations });

    const result = await engine.evaluatePendingOutcomes({ tenantId: 'tenant-a' });

    expect(result.total).toBe(0);
    expect(recommendations[0].status).toBe('applied');
  });

  test('baseline vazio: permanece applied sem avaliar', async () => {
    const recommendations = [buildRecommendation({
      status: 'applied',
      metadata: {
        application: { appliedAt: new Date().toISOString(), appliedBy: 'x', baseline: [], expectedDirection: 'up' },
      },
    })];
    const { engine } = loadEngine({ recommendations });

    const result = await engine.evaluatePendingOutcomes({ tenantId: 'tenant-a' });

    expect(result).toMatchObject({ total: 1, evaluated: 0, pending: 1 });
    expect(recommendations[0].status).toBe('applied');
  });
});

describe('RecommendationEngine — Action real (create_task)', () => {
  test('generateRecommendations persiste action create_task no metadata', async () => {
    const insights = [{
      id: 'ins-1',
      tenant_key: 'tenant-a',
      type: 'metric_drop',
      related_metrics: ['operations.tickets_open'],
    }];
    const { engine } = loadEngine({ insights });

    const result = await engine.generateRecommendations({ tenantId: 'tenant-a', insights });

    expect(result.created).toBe(1);
    expect(result.recommendations[0].metadata.action).toEqual({
      kind: 'create_task',
      label: 'Criar tarefa de investigacao',
    });
  });

  test('apply com action create_task executa createTask e grava executedAction', async () => {
    const recommendations = [buildRecommendation({
      title: 'Acionar investigacao para queda de metrica',
      priority: 'high',
      metadata: {
        sourceInsightType: 'metric_drop',
        relatedMetrics: ['operations.tickets_open'],
        action: { kind: 'create_task', label: 'Criar tarefa de investigacao' },
      },
    })];
    const { engine, workspaceOperations } = loadEngine({ recommendations });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'manager-1',
    });

    expect(result.ok).toBe(true);
    expect(workspaceOperations.createTask).toHaveBeenCalledTimes(1);
    const taskCall = workspaceOperations.createTask.mock.calls[0][0];
    expect(taskCall.tenantId).toBe('tenant-a');
    expect(taskCall.payload.title).toBe('[Recomendação] Acionar investigacao para queda de metrica');
    expect(taskCall.payload.type).toBe('recommendation');
    expect(taskCall.payload.priority).toBe('high');
    expect(taskCall.payload.description).toContain('recomendação reco-1');

    expect(result.execution).toMatchObject({
      kind: 'create_task',
      status: 'executed',
      taskId: 'task-1',
      label: 'Criar tarefa de investigacao',
    });
    expect(result.recommendation.metadata.application.executedAction.status).toBe('executed');
    expect(result.recommendation.metadata.application.executedAction.taskId).toBe('task-1');
  });

  test('apply sem action no metadata nao executa nada (compatibilidade)', async () => {
    const recommendations = [buildRecommendation()];
    const { engine, workspaceOperations } = loadEngine({ recommendations });

    const result = await engine.applyRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.ok).toBe(true);
    expect(result.execution).toBeUndefined();
    expect(workspaceOperations.createTask).not.toHaveBeenCalled();
  });

  test('falha na execucao da task nao reverte o apply (execution failed explicito)', async () => {
    const recommendations = [buildRecommendation({
      metadata: {
        sourceInsightType: 'metric_drop',
        relatedMetrics: [],
        action: { kind: 'create_task', label: 'Criar tarefa de investigacao' },
      },
    })];
    const { engine, workspaceOperations } = loadEngine({ recommendations });
    workspaceOperations.createTask.mockRejectedValueOnce(new Error('workspace indisponivel'));

    const result = await engine.applyRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.ok).toBe(true);
    expect(result.recommendation.status).toBe('applied');
    expect(result.execution).toMatchObject({ kind: 'create_task', status: 'failed' });
    expect(result.execution.error).toContain('workspace indisponivel');
    expect(result.recommendation.metadata.application.executedAction.status).toBe('failed');
  });
});

describe('RecommendationEngine — Learn (outcome vira evidencia)', () => {
  const futureIso = () => new Date(Date.now() + 60 * 1000).toISOString();

  async function applyWithInsight({ newValue } = {}) {
    const metricKey = 'operations.tickets_open';
    const recommendations = [buildRecommendation({
      insight_id: 'ins-1',
      metadata: {
        sourceInsightType: 'metric_drop',
        relatedMetrics: [metricKey],
      },
    })];
    const insights = [{ id: 'ins-1', tenant_key: 'tenant-a', related_metrics: [metricKey] }];
    const snapshots = [buildSnapshot({ id: 'snap-base', metric_key: metricKey, value: 100 })];
    const ctx = loadEngine({ recommendations, insights, snapshots });

    await ctx.engine.applyRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-1', actor: 'x' });

    if (newValue != null) {
      snapshots.push(buildSnapshot({
        id: 'snap-new',
        metric_key: metricKey,
        value: newValue,
        period_start: '2026-09-01T00:00:00.000Z',
        period_end: futureIso(),
        created_at: futureIso(),
      }));
    }

    const result = await ctx.engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });
    return { result, ...ctx };
  }

  test('outcome medido (improved) grava evidencia outcome_evaluation no insight', async () => {
    const { result, evidenceEngine } = await applyWithInsight({ newValue: 130 });

    expect(result.outcome.outcome).toBe('improved');
    expect(result.evidenceRecorded).toBe(true);
    expect(evidenceEngine.createEvidence).toHaveBeenCalledTimes(1);
    const evidence = evidenceEngine.createEvidence.mock.calls[0][0];
    expect(evidence.tenantId).toBe('tenant-a');
    expect(evidence.insightId).toBe('ins-1');
    expect(evidence.evidenceType).toBe('outcome_evaluation');
    expect(evidence.sourceType).toBe('tenant_recommendation');
    expect(evidence.sourceId).toBe('reco-1');
    expect(evidence.excerpt).toContain('improved');
    expect(evidence.structuredData.outcome).toBe('improved');
    expect(evidence.structuredData.metrics[0].currentValue).toBe(130);
  });

  test('outcome pending nao grava evidencia (aguardando dados)', async () => {
    const { result, evidenceEngine } = await applyWithInsight({ newValue: null });

    expect(result.outcome.outcome).toBe('pending');
    expect(result.evidenceRecorded).toBe(false);
    expect(evidenceEngine.createEvidence).not.toHaveBeenCalled();
  });

  test('sem insight_id nao grava evidencia mesmo com outcome medido', async () => {
    const metricKey = 'operations.tickets_open';
    const recommendations = [buildRecommendation({
      insight_id: null,
      metadata: { sourceInsightType: 'metric_drop', relatedMetrics: [metricKey] },
    })];
    const snapshots = [buildSnapshot({ id: 'snap-base', metric_key: metricKey, value: 100 })];
    const { engine, evidenceEngine } = loadEngine({ recommendations, snapshots });

    await engine.applyRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-1', actor: 'x' });
    snapshots.push(buildSnapshot({
      id: 'snap-new',
      metric_key: metricKey,
      value: 130,
      period_start: '2026-09-01T00:00:00.000Z',
      period_end: futureIso(),
      created_at: futureIso(),
    }));

    const result = await engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.outcome.outcome).toBe('improved');
    expect(result.evidenceRecorded).toBe(false);
    expect(evidenceEngine.createEvidence).not.toHaveBeenCalled();
  });

  test('falha do EvidenceEngine nao derruba a avaliacao (evidenceRecorded=false)', async () => {
    const metricKey = 'operations.tickets_open';
    const recommendations = [buildRecommendation({
      insight_id: 'ins-1',
      metadata: { sourceInsightType: 'metric_drop', relatedMetrics: [metricKey] },
    })];
    const insights = [{ id: 'ins-1', tenant_key: 'tenant-a', related_metrics: [metricKey] }];
    const snapshots = [buildSnapshot({ id: 'snap-base', metric_key: metricKey, value: 100 })];
    const ctx = loadEngine({ recommendations, insights, snapshots });
    ctx.evidenceEngine.createEvidence.mockRejectedValueOnce(new Error('db offline'));

    await ctx.engine.applyRecommendation({ tenantId: 'tenant-a', recommendationId: 'reco-1', actor: 'x' });
    snapshots.push(buildSnapshot({
      id: 'snap-new',
      metric_key: metricKey,
      value: 130,
      period_start: '2026-09-01T00:00:00.000Z',
      period_end: futureIso(),
      created_at: futureIso(),
    }));
    const result = await ctx.engine.evaluateOutcome({ tenantId: 'tenant-a', recommendationId: 'reco-1' });

    expect(result.ok).toBe(true);
    expect(result.outcome.outcome).toBe('improved');
    expect(result.evidenceRecorded).toBe(false);
  });
});
