'use strict';

/**
 * Tenant Intelligence — Autonomy UX (auto-apply governado por autonomyLevel).
 * Unit tests com DB mockado (mesmo padrao de tenantRecommendationOutcome.test.js).
 */

function buildRecommendationModel(store, { throwOnId = null } = {}) {
  return {
    create: jest.fn(async (data) => {
      const record = { status: 'open', estimated_impact: {}, metadata: {}, ...data };
      store.push(record);
      return { toJSON: () => record };
    }),
    findOne: jest.fn(async ({ where } = {}) => {
      if (throwOnId && where?.id === throwOnId) throw new Error('db boom');
      const found = store.find((item) => {
        if (where?.id && item.id !== where.id) return false;
        if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
        if (where?.insight_id && item.insight_id !== where.insight_id) return false;
        if (where?.action_type && item.action_type !== where.action_type) return false;
        if (where?.status && item.status !== where.status) return false;
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
      const found = matches[0];
      return { toJSON: () => found };
    }),
  };
}

function loadEngine({
  recommendations = [],
  insights = [],
  snapshots = [],
  autonomyLevel = 'suggest',
  capabilitiesError = null,
  throwOnId = null,
} = {}) {
  jest.resetModules();
  const recommendationModel = buildRecommendationModel(recommendations, { throwOnId });
  const insightModel = buildInsightModel(insights);
  const snapshotModel = buildSnapshotModel(snapshots);
  const workspaceOperations = { createTask: jest.fn(async () => ({ id: 'task-1' })) };
  const evidenceEngine = { createEvidence: jest.fn(async (payload) => payload) };
  const capabilitiesService = {
    getTenantCapabilities: jest.fn(async () => {
      if (capabilitiesError) throw capabilitiesError;
      return { inbox: true, caseManagement: true, caseCreationPolicy: 'manual', autonomyLevel };
    }),
  };
  jest.doMock('../../api/db/models', () => ({
    TenantRecommendation: () => recommendationModel,
    TenantInsight: () => insightModel,
    TenantMetricSnapshot: () => snapshotModel,
  }));
  // eslint-disable-next-line global-require
  const { RecommendationEngine } = require('../../api/core/tenant-intelligence/RecommendationEngine');
  return {
    engine: new RecommendationEngine({ workspaceOperations, evidenceEngine, capabilitiesService }),
    recommendationModel,
    workspaceOperations,
    capabilitiesService,
    store: recommendations,
  };
}

function buildInsight(overrides = {}) {
  return {
    id: 'ins-1',
    tenant_key: 'tenant-a',
    type: 'metric_drop',
    related_metrics: ['operations.tickets_open'],
    metadata: {},
    ...overrides,
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

describe('RecommendationEngine — auto-apply por autonomyLevel', () => {
  test("suggest (default) nao aplica automaticamente e declara manual_autonomy", async () => {
    const { engine, store } = loadEngine({ autonomyLevel: 'suggest' });

    const result = await engine.generateRecommendations({
      tenantId: 'tenant-a',
      insights: [buildInsight()],
      goals: [],
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(1);
    expect(result.autoApply).toEqual({ attempted: false, reason: 'manual_autonomy', autonomyLevel: 'suggest' });
    expect(store[0].status).toBe('open');
  });

  test("approve tambem e manual na geracao (batch e acao humana via apply-all)", async () => {
    const { engine, store } = loadEngine({ autonomyLevel: 'approve' });

    const result = await engine.generateRecommendations({
      tenantId: 'tenant-a',
      insights: [buildInsight()],
      goals: [],
    });

    expect(result.autoApply).toEqual({ attempted: false, reason: 'manual_autonomy', autonomyLevel: 'approve' });
    expect(store[0].status).toBe('open');
  });

  test("autonomous aplica todas as recomendacoes criadas com actor system e origin auto", async () => {
    const { engine, store, workspaceOperations } = loadEngine({ autonomyLevel: 'autonomous' });

    const result = await engine.generateRecommendations({
      tenantId: 'tenant-a',
      insights: [
        buildInsight({ id: 'ins-1', type: 'metric_drop' }),
        buildInsight({ id: 'ins-2', type: 'metric_increase' }),
      ],
      goals: [],
    });

    expect(result.created).toBe(2);
    expect(result.autoApply).toMatchObject({ attempted: true, autonomyLevel: 'autonomous', applied: 2, failed: 0 });
    expect(store.every((item) => item.status === 'applied')).toBe(true);
    expect(store.every((item) => item.metadata?.application?.appliedBy === 'system')).toBe(true);
    expect(store.every((item) => item.metadata?.application?.origin === 'auto')).toBe(true);
    // Action real: cada auto-apply executa a acao mapeada (create_task).
    expect(workspaceOperations.createTask).toHaveBeenCalledTimes(2);
  });

  test("exception_only aplica todas exceto priority high (excecao humana)", async () => {
    const { engine, store } = loadEngine({ autonomyLevel: 'exception_only' });

    const result = await engine.generateRecommendations({
      tenantId: 'tenant-a',
      insights: [
        buildInsight({ id: 'ins-high', type: 'goal_off_track' }), // priority high
        buildInsight({ id: 'ins-med', type: 'metric_drop' }), // priority medium
      ],
      goals: [],
    });

    expect(result.created).toBe(2);
    expect(result.autoApply).toMatchObject({
      attempted: true,
      autonomyLevel: 'exception_only',
      applied: 1,
      failed: 0,
      skippedHighPriority: 1,
    });
    const high = store.find((item) => item.insight_id === 'ins-high');
    const medium = store.find((item) => item.insight_id === 'ins-med');
    expect(high.status).toBe('open');
    expect(medium.status).toBe('applied');
    expect(medium.metadata.application.origin).toBe('auto');
  });

  test("falha ao ler capabilities e fail-soft explicito (capabilities_unavailable)", async () => {
    const { engine, store } = loadEngine({ capabilitiesError: new Error('db offline') });

    const result = await engine.generateRecommendations({
      tenantId: 'tenant-a',
      insights: [buildInsight()],
      goals: [],
    });

    expect(result.ok).toBe(true);
    expect(result.created).toBe(1);
    expect(result.autoApply).toEqual({ attempted: false, reason: 'capabilities_unavailable' });
    expect(store[0].status).toBe('open');
  });

  test('sem recomendacoes criadas nao tenta auto-apply', async () => {
    const { engine, capabilitiesService } = loadEngine({ autonomyLevel: 'autonomous' });

    const result = await engine.generateRecommendations({ tenantId: 'tenant-a', insights: [], goals: [] });

    expect(result.autoApply).toEqual({ attempted: false, reason: 'no_recommendations_created' });
    expect(capabilitiesService.getTenantCapabilities).not.toHaveBeenCalled();
  });

  test('falha individual de apply conta em failed sem derrubar a geracao', async () => {
    const { engine, store } = loadEngine({ autonomyLevel: 'autonomous' });
    // Sabotagem: primeiro create tem id fixo; fazemos o segundo apply falhar
    // via store — mais simples: engine com 1 insight e apply espiado.
    const applySpy = jest.spyOn(engine, 'applyRecommendation')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: true });

    const result = await engine.generateRecommendations({
      tenantId: 'tenant-a',
      insights: [
        buildInsight({ id: 'ins-1', type: 'metric_drop' }),
        buildInsight({ id: 'ins-2', type: 'metric_increase' }),
      ],
      goals: [],
    });

    expect(result.created).toBe(2);
    expect(result.autoApply).toMatchObject({ attempted: true, applied: 1, failed: 1 });
    expect(applySpy).toHaveBeenCalledTimes(2);
    void store;
  });
});

describe('RecommendationEngine.applyRecommendation — origin', () => {
  test("aplicacao manual registra origin 'manual' por default", async () => {
    const { engine, store } = loadEngine({ recommendations: [buildRecommendation()] });

    const result = await engine.applyRecommendation({
      tenantId: 'tenant-a',
      recommendationId: 'reco-1',
      actor: 'agent-1',
    });

    expect(result.ok).toBe(true);
    expect(store[0].metadata.application.origin).toBe('manual');
    expect(store[0].metadata.application.appliedBy).toBe('agent-1');
  });
});

describe('RecommendationEngine.applyAllOpen — aprovacao em lote', () => {
  test('aplica todas as abertas com origin batch e actor humano', async () => {
    const { engine, store } = loadEngine({
      recommendations: [
        buildRecommendation({ id: 'reco-1' }),
        buildRecommendation({ id: 'reco-2', action_type: 'human_review', priority: 'low' }),
        buildRecommendation({ id: 'reco-3', status: 'applied' }),
      ],
    });

    const result = await engine.applyAllOpen({ tenantId: 'tenant-a', actor: 'agent-1' });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toHaveLength(2);
    const reco1 = store.find((item) => item.id === 'reco-1');
    const reco2 = store.find((item) => item.id === 'reco-2');
    const reco3 = store.find((item) => item.id === 'reco-3');
    expect(reco1.status).toBe('applied');
    expect(reco2.status).toBe('applied');
    expect(reco1.metadata.application.origin).toBe('batch');
    expect(reco1.metadata.application.appliedBy).toBe('agent-1');
    // Ja aplicada antes do lote nao foi tocada de novo.
    expect(reco3.metadata.application).toBeUndefined();
  });

  test('falha individual nao interrompe o lote e fica explicita em results', async () => {
    const { engine } = loadEngine({
      recommendations: [
        buildRecommendation({ id: 'reco-bad' }),
        buildRecommendation({ id: 'reco-good' }),
      ],
      throwOnId: 'reco-bad',
    });

    const result = await engine.applyAllOpen({ tenantId: 'tenant-a', actor: 'agent-1' });

    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    const bad = result.results.find((item) => item.recommendationId === 'reco-bad');
    const good = result.results.find((item) => item.recommendationId === 'reco-good');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('boom');
    expect(good.ok).toBe(true);
  });

  test('sem recomendacoes abertas retorna lote vazio', async () => {
    const { engine } = loadEngine({ recommendations: [] });

    const result = await engine.applyAllOpen({ tenantId: 'tenant-a', actor: 'agent-1' });

    expect(result).toEqual({ ok: true, applied: 0, failed: 0, results: [] });
  });
});
