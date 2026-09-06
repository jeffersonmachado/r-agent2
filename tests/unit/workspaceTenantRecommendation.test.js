'use strict';

/**
 * WorkspaceActionService.topTenantRecommendation — unificacao
 * RecommendationEngine (tenant-intelligence) <-> Workspace NBA.
 * Deps mockadas; shape allowlisted e fail-closed.
 */

const WorkspaceActionService = require('../../api/services/workspace/WorkspaceActionService');

function buildService({ recommendations = [], engineError = null } = {}) {
  const recommendationEngine = {
    listRecommendations: jest.fn(async () => {
      if (engineError) throw engineError;
      return { items: recommendations, total: recommendations.length };
    }),
  };
  const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
  const service = new WorkspaceActionService({
    WorkspaceAction: () => ({ findAll: jest.fn(async () => []), create: jest.fn() }),
    WorkspaceEntityLink: () => ({ findOne: jest.fn(async () => null) }),
    insightService: { generateInsights: jest.fn(async () => ({ items: [] })) },
    operationsService: { createTask: jest.fn() },
    recommendationEngine,
    logger,
  });
  return { service, recommendationEngine, logger };
}

function buildRecommendation(overrides = {}) {
  return {
    id: 'reco-1',
    tenant_key: 'tenant-a',
    title: 'Revisar operacao para meta fora da faixa',
    description: 'A meta esta fora da faixa.',
    priority: 'medium',
    status: 'open',
    metadata: {},
    createdAt: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('WorkspaceActionService.topTenantRecommendation', () => {
  test('retorna a recomendacao aberta de maior prioridade com shape allowlisted', async () => {
    const recommendations = [
      buildRecommendation({ id: 'reco-low', priority: 'low' }),
      buildRecommendation({
        id: 'reco-high',
        priority: 'high',
        metadata: {
          probableCauses: [{ metricKey: 'operations.abandonment_rate_pct', changeRatio: 0.4, direction: 'up' }],
          projection: { projectedValue: 6, targetValue: 10, elapsedFraction: 0.5, projectedStatus: 'will_miss' },
          action: { kind: 'create_task', label: 'Criar tarefa de investigacao' },
          // campo bruto que NAO pode vazar no shape allowlisted
          evaluation: { internal: true },
        },
      }),
      buildRecommendation({ id: 'reco-medium', priority: 'medium' }),
    ];
    const { service, recommendationEngine } = buildService({ recommendations });

    const result = await service.topTenantRecommendation({ tenantId: 'tenant-a' });

    expect(recommendationEngine.listRecommendations).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      status: 'open',
      limit: 100,
    });
    expect(result.id).toBe('reco-high');
    expect(result.title).toBe('Revisar operacao para meta fora da faixa');
    expect(result.priority).toBe('high');
    expect(result.probableCauses).toHaveLength(1);
    expect(result.projection.projectedStatus).toBe('will_miss');
    expect(result.action.kind).toBe('create_task');
    // allowlist: metadata bruto nao vaza
    expect(result.metadata).toBeUndefined();
    expect(result.evaluation).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual([
      'action', 'createdAt', 'description', 'id', 'priority', 'probableCauses', 'projection', 'title',
    ]);
  });

  test('sem recomendacoes abertas retorna null', async () => {
    const { service } = buildService({ recommendations: [] });
    expect(await service.topTenantRecommendation({ tenantId: 'tenant-a' })).toBeNull();
  });

  test('sem tenantId retorna null sem chamar o engine', async () => {
    const { service, recommendationEngine } = buildService();
    expect(await service.topTenantRecommendation({})).toBeNull();
    expect(recommendationEngine.listRecommendations).not.toHaveBeenCalled();
  });

  test('falha do RecommendationEngine e fail-closed (null + warn), nao derruba o Workspace', async () => {
    const { service, logger } = buildService({ engineError: new Error('db offline') });

    const result = await service.topTenantRecommendation({ tenantId: 'tenant-a' });

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('recomendacao sem metadata retorna campos derivados vazios/nulos', async () => {
    const { service } = buildService({ recommendations: [buildRecommendation()] });

    const result = await service.topTenantRecommendation({ tenantId: 'tenant-a' });

    expect(result.probableCauses).toEqual([]);
    expect(result.projection).toBeNull();
    expect(result.action).toBeNull();
  });
});
