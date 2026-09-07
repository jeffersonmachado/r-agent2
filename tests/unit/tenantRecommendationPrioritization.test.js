'use strict';

/**
 * RecommendationEngine — priorização por eficácia histórica.
 * listRecommendations({status:'open'}) re-ordena: mesma prioridade, o tipo
 * de ação com melhor taxa de sucesso medida no tenant vem primeiro.
 * Guarda de amostra: menos de 3 outcomes avaliados → neutro.
 * DB mockado (padrão tenantRecommendationStats).
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
      .map((item) => ({ toJSON: () => item }))),
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
  return { engine: new RecommendationEngine({}) };
}

let seq = 0;
function reco(overrides = {}) {
  seq += 1;
  return {
    id: `reco-${seq}`,
    tenant_key: 'tenant-a',
    action_type: 'operational_review',
    status: 'open',
    priority: 'medium',
    metadata: {},
    // created_at crescente: reco-1 mais antigo, reco-N mais recente.
    // O banco devolve DESC; o mock preserva a ordem do array — então os
    // casos montam o array já na ordem DESC esperada do banco.
    created_at: new Date(Date.UTC(2026, 8, 1, 10, 0, seq)).toISOString(),
    ...overrides,
  };
}

function evaluated(actionType, outcome, n) {
  const list = [];
  for (let i = 0; i < n; i += 1) {
    list.push(reco({
      action_type: actionType,
      status: 'completed',
      metadata: { outcome: { outcome } },
    }));
  }
  return list;
}

describe('RecommendationEngine.listRecommendations — priorização por eficácia histórica', () => {
  test('mesma prioridade: tipo com melhor taxa histórica vem primeiro e carrega efficacy', async () => {
    const openA = reco({ id: 'open-rebalance', action_type: 'rebalance_queue', priority: 'high' });
    const openB = reco({ id: 'open-review', action_type: 'operational_review', priority: 'high' });
    const { engine } = loadEngine({
      recommendations: [
        // ordem do "banco" (created_at DESC): openB mais recente primeiro
        openB, openA,
        ...evaluated('rebalance_queue', 'improved', 3),
        ...evaluated('operational_review', 'unchanged', 2),
        ...evaluated('operational_review', 'regressed', 1),
      ],
    });

    const { items } = await engine.listRecommendations({ tenantId: 'tenant-a', status: 'open' });

    expect(items.map((i) => i.id)).toEqual(['open-rebalance', 'open-review']);
    expect(items[0].efficacy).toEqual({ successRate: 1, samples: 3 });
    expect(items[1].efficacy).toEqual({ successRate: 0, samples: 3 });
  });

  test('prioridade domina a eficácia: high sem histórico fica à frente de low com 100%', async () => {
    const openHigh = reco({ id: 'open-high', action_type: 'operational_review', priority: 'high' });
    const openLow = reco({ id: 'open-low', action_type: 'rebalance_queue', priority: 'low' });
    const { engine } = loadEngine({
      recommendations: [openHigh, openLow, ...evaluated('rebalance_queue', 'improved', 3)],
    });

    const { items } = await engine.listRecommendations({ tenantId: 'tenant-a', status: 'open' });

    expect(items.map((i) => i.id)).toEqual(['open-high', 'open-low']);
    expect(items[0].efficacy).toBeUndefined();
    expect(items[1].efficacy).toEqual({ successRate: 1, samples: 3 });
  });

  test('guarda de amostra: menos de 3 avaliadas → neutro, ordem cronológica preservada', async () => {
    const openB = reco({ id: 'open-rebalance', action_type: 'rebalance_queue', priority: 'medium' });
    const openA = reco({ id: 'open-review', action_type: 'operational_review', priority: 'medium' });
    const { engine } = loadEngine({
      recommendations: [
        // ordem DESC do banco: openA (mais recente) primeiro
        openA, openB,
        ...evaluated('rebalance_queue', 'improved', 2), // só 2 amostras
      ],
    });

    const { items } = await engine.listRecommendations({ tenantId: 'tenant-a', status: 'open' });

    expect(items.map((i) => i.id)).toEqual(['open-review', 'open-rebalance']);
    expect(items[0].efficacy).toBeUndefined();
    expect(items[1].efficacy).toBeUndefined();
  });

  test('listagem não-open (applied) não é re-rankeada nem anotada', async () => {
    const applied = reco({
      id: 'applied-1',
      action_type: 'rebalance_queue',
      status: 'applied',
      metadata: { application: { origin: 'manual' } },
    });
    const { engine } = loadEngine({
      recommendations: [applied, ...evaluated('rebalance_queue', 'improved', 3)],
    });

    const { items } = await engine.listRecommendations({ tenantId: 'tenant-a', status: 'applied' });

    expect(items.map((i) => i.id)).toEqual(['applied-1']);
    expect(items[0].efficacy).toBeUndefined();
  });

  test('falha na agregação de eficácia não derruba a listagem (fail-open)', async () => {
    const openA = reco({ id: 'open-a', priority: 'medium' });
    const openB = reco({ id: 'open-b', priority: 'medium' });
    jest.resetModules();
    const recommendationModel = buildRecommendationModel([openB, openA]);
    let calls = 0;
    recommendationModel.findAll = jest.fn(async ({ where } = {}) => {
      calls += 1;
      if (calls > 1) throw new Error('efficacy store down'); // 2ª chamada = _getActionTypeEfficacy
      return [openB, openA].filter((i) => i.status === where.status).map((i) => ({ toJSON: () => i }));
    });
    jest.doMock('../../api/db/models', () => ({
      TenantRecommendation: () => recommendationModel,
      TenantInsight: () => ({ findOne: jest.fn(async () => null) }),
      TenantMetricSnapshot: () => ({ findOne: jest.fn(async () => null) }),
    }));
    // eslint-disable-next-line global-require
    const { RecommendationEngine } = require('../../api/core/tenant-intelligence/RecommendationEngine');
    const engine = new RecommendationEngine({});

    const { items } = await engine.listRecommendations({ tenantId: 'tenant-a', status: 'open' });

    expect(items.map((i) => i.id)).toEqual(['open-b', 'open-a']);
  });

  test('outcomes não avaliados (pending) não contam como amostra', async () => {
    const openA = reco({ id: 'open-rebalance', action_type: 'rebalance_queue', priority: 'medium' });
    const openB = reco({ id: 'open-review', action_type: 'operational_review', priority: 'medium' });
    const pendingReco = (actionType) => reco({
      action_type: actionType, status: 'applied', metadata: { outcome: { outcome: 'pending' } },
    });
    const { engine } = loadEngine({
      recommendations: [
        openA, openB,
        pendingReco('rebalance_queue'), pendingReco('rebalance_queue'), pendingReco('rebalance_queue'),
        ...evaluated('operational_review', 'improved', 3),
      ],
    });

    const { items } = await engine.listRecommendations({ tenantId: 'tenant-a', status: 'open' });

    // rebalance sem amostra válida → neutro; review com 100% (3 amostras) primeiro
    expect(items.map((i) => i.id)).toEqual(['open-review', 'open-rebalance']);
    expect(items[0].efficacy).toEqual({ successRate: 1, samples: 3 });
  });
});
