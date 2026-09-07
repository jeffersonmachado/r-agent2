'use strict';

/**
 * Tenant Intelligence — Product Metrics da camada de decisão
 * (getRecommendationStats): aceite, outcome e automação agregados de
 * tenant_recommendations. DB mockado (padrão tenantRecommendationOutcome).
 */

function buildRecommendationModel(store) {
  return {
    create: jest.fn(async (data) => {
      const record = { status: 'open', estimated_impact: {}, metadata: {}, ...data };
      store.push(record);
      return { toJSON: () => record };
    }),
    findOne: jest.fn(async () => null),
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

function loadEngine({ recommendations = [] } = {}) {
  jest.resetModules();
  const recommendationModel = buildRecommendationModel(recommendations);
  jest.doMock('../../api/db/models', () => ({
    TenantRecommendation: () => recommendationModel,
    TenantInsight: () => ({ findOne: jest.fn(async () => null) }),
    TenantMetricSnapshot: () => ({ findOne: jest.fn(async () => null) }),
  }));
  // eslint-disable-next-line global-require
  const { RecommendationEngine } = require('../../api/core/tenant-intelligence/RecommendationEngine');
  return {
    engine: new RecommendationEngine({
      workspaceOperations: { createTask: jest.fn() },
      evidenceEngine: { createEvidence: jest.fn() },
      capabilitiesService: { getTenantCapabilities: jest.fn(async () => ({ autonomyLevel: 'suggest' })) },
    }),
  };
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function reco(overrides = {}) {
  return {
    id: `reco-${Math.random().toString(36).slice(2, 8)}`,
    tenant_key: 'tenant-a',
    status: 'open',
    metadata: {},
    created_at: daysAgo(2),
    ...overrides,
  };
}

function applied(origin, outcome = null) {
  return reco({
    status: outcome ? 'completed' : 'applied',
    metadata: {
      application: { origin, appliedBy: origin === 'manual' ? 'agent-1' : 'system' },
      ...(outcome ? { outcome: { outcome } } : {}),
    },
  });
}

describe('RecommendationEngine.getRecommendationStats', () => {
  test('sem recomendações: totais zerados e taxas null (sem divisão por zero)', async () => {
    const { engine } = loadEngine({ recommendations: [] });

    const { stats } = await engine.getRecommendationStats({ tenantId: 'tenant-a' });

    expect(stats.total).toBe(0);
    expect(stats.byStatus).toEqual({ open: 0, applied: 0, dismissed: 0, completed: 0 });
    expect(stats.acceptance.rate).toBeNull();
    expect(stats.outcome.successRate).toBeNull();
    expect(stats.automation.automationRate).toBeNull();
    expect(stats.automation.humanInterventionRate).toBeNull();
  });

  test('agrega aceite, outcome e automação corretamente', async () => {
    const { engine } = loadEngine({
      recommendations: [
        reco({ id: 'r-open' }),
        applied('manual', 'improved'),
        applied('auto', 'improved'),
        applied('batch', 'regressed'),
        applied('manual'), // aplicada, aguardando outcome
        reco({ id: 'r-dismissed', status: 'dismissed' }),
      ],
    });

    const { stats } = await engine.getRecommendationStats({ tenantId: 'tenant-a' });

    expect(stats.total).toBe(6);
    expect(stats.byStatus).toEqual({ open: 1, applied: 1, dismissed: 1, completed: 3 });
    // aceite: 4 aceitas de 5 decididas (4 + 1 dismissed)
    expect(stats.acceptance).toEqual({ decided: 5, accepted: 4, dismissed: 1, rate: 4 / 5 });
    // outcome: 3 avaliadas, 2 improved, 1 regressed; 1 aplicada pendente
    expect(stats.outcome.evaluated).toBe(3);
    expect(stats.outcome.successRate).toBe(2 / 3);
    expect(stats.outcome.pendingEvaluation).toBe(1);
    // automação: 2 de 4 aplicadas sem humano; 2 manuais
    expect(stats.automation.applied).toBe(4);
    expect(stats.automation.automationRate).toBe(2 / 4);
    expect(stats.automation.humanInterventionRate).toBe(2 / 4);
  });

  test('período filtra por created_at (day exclui itens antigos)', async () => {
    const { engine } = loadEngine({
      recommendations: [
        applied('auto', 'improved'), // recente (2d)
        reco({ id: 'r-old', status: 'dismissed', created_at: daysAgo(40) }),
      ],
    });

    const { stats } = await engine.getRecommendationStats({ tenantId: 'tenant-a', period: 'day' });

    expect(stats.total).toBe(0); // 2 dias atrás está fora da janela de 1 dia
    expect(stats.acceptance.rate).toBeNull();

    const { stats: month } = await engine.getRecommendationStats({ tenantId: 'tenant-a', period: 'month' });
    expect(month.total).toBe(1); // só a recente; a de 40d fica fora de 30d

    const { stats: all } = await engine.getRecommendationStats({ tenantId: 'tenant-a', period: 'all' });
    expect(all.total).toBe(2);
  });

  test('período inválido cai no default month', async () => {
    const { engine } = loadEngine({ recommendations: [reco()] });

    const { stats } = await engine.getRecommendationStats({ tenantId: 'tenant-a', period: 'yolo' });

    expect(stats.period).toBe('month');
  });

  test('isolamento de tenant: não agrega recomendações de outro tenant', async () => {
    const { engine } = loadEngine({
      recommendations: [
        applied('auto', 'improved'),
        reco({ tenant_key: 'tenant-b', status: 'dismissed' }),
      ],
    });

    const { stats } = await engine.getRecommendationStats({ tenantId: 'tenant-a' });

    expect(stats.total).toBe(1);
    expect(stats.acceptance.dismissed).toBe(0);
  });

  test('sem tenantId lança erro explícito', async () => {
    const { engine } = loadEngine();

    await expect(engine.getRecommendationStats({})).rejects.toThrow('tenantId is required');
  });
});

describe('RecommendationEngine.getRecommendationStats — eficácia por cadeia causal', () => {
  function followUp(parentId, variant, outcome = null, extraMetadata = {}) {
    return reco({
      action_type: variant,
      status: outcome ? 'completed' : 'applied',
      metadata: {
        followUpOf: parentId,
        followUpDepth: 1,
        followUpReason: 'no_agent_response',
        ...(outcome ? { outcome: { outcome } } : {}),
        ...extraMetadata,
      },
    });
  }

  test('sem follow-ups → chainEfficacy zerado e chains vazio', async () => {
    const { engine } = loadEngine({ recommendations: [applied('auto', 'improved')] });

    const { stats } = await engine.getRecommendationStats({ tenantId: 'tenant-a' });

    expect(stats.chainEfficacy).toEqual({ followUps: 0, evaluated: 0, chains: {} });
  });

  test('follow-up improved agrega na cadeia rebalance_queue->manager_escalation com successRate 1', async () => {
    const parent = reco({
      id: 'reco-parent',
      action_type: 'rebalance_queue',
      status: 'completed',
      metadata: { outcome: { outcome: 'unchanged', reason: 'no_agent_response' } },
    });
    const child = followUp('reco-parent', 'manager_escalation', 'improved');
    const { engine } = loadEngine({ recommendations: [parent, child] });

    const { stats } = await engine.getRecommendationStats({ tenantId: 'tenant-a' });

    expect(stats.chainEfficacy.followUps).toBe(1);
    expect(stats.chainEfficacy.evaluated).toBe(1);
    const chain = stats.chainEfficacy.chains['rebalance_queue->manager_escalation'];
    expect(chain).toMatchObject({
      parentAction: 'rebalance_queue', variant: 'manager_escalation',
      total: 1, improved: 1, unchanged: 0, regressed: 0, pending: 0, successRate: 1,
    });
  });

  test('duas variantes agregam separado; pending não entra no denominador', async () => {
    const parent = reco({ id: 'reco-parent', action_type: 'rebalance_queue', status: 'completed', metadata: {} });
    const { engine } = loadEngine({
      recommendations: [
        parent,
        followUp('reco-parent', 'manager_escalation', 'improved'),
        followUp('reco-parent', 'manager_escalation', 'unchanged'),
        followUp('reco-parent', 'staffing_review', null),
      ],
    });

    const { stats } = await engine.getRecommendationStats({ tenantId: 'tenant-a' });

    expect(stats.chainEfficacy.followUps).toBe(3);
    expect(stats.chainEfficacy.evaluated).toBe(2);
    expect(stats.chainEfficacy.chains['rebalance_queue->manager_escalation'])
      .toMatchObject({ total: 2, improved: 1, unchanged: 1, successRate: 0.5 });
    expect(stats.chainEfficacy.chains['rebalance_queue->staffing_review'])
      .toMatchObject({ total: 1, pending: 1, successRate: null });
  });

  test('pai fora da janela/loja agrega com parentAction unknown (nunca inventa o pai)', async () => {
    const child = followUp('reco-inexistente', 'staffing_review', 'improved');
    const { engine } = loadEngine({ recommendations: [child] });

    const { stats } = await engine.getRecommendationStats({ tenantId: 'tenant-a' });

    expect(stats.chainEfficacy.chains['unknown->staffing_review'])
      .toMatchObject({ parentAction: 'unknown', total: 1, improved: 1, successRate: 1 });
  });
});
