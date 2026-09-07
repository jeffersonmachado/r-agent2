'use strict';

/**
 * WorkspaceActionService.topTenantRecommendation — unificacao
 * RecommendationEngine (tenant-intelligence) <-> Workspace NBA.
 * Deps mockadas; shape allowlisted e fail-closed.
 */

const WorkspaceActionService = require('../../api/services/workspace/WorkspaceActionService');

function buildService({ recommendations = [], engineError = null } = {}) {
  const recommendationEngine = {
    listRecommendations: jest.fn(async ({ status } = {}) => {
      if (engineError) throw engineError;
      const items = status ? recommendations.filter((item) => item.status === status) : recommendations;
      return { items, total: items.length };
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

describe('WorkspaceActionService.recentRecommendationOutcomes', () => {
  function appliedRecommendation(overrides = {}) {
    return buildRecommendation({
      status: 'completed',
      metadata: {
        application: {
          appliedAt: '2026-09-06T10:00:00.000Z',
          appliedBy: 'user-1',
          origin: 'manual',
          baseline: [],
          executedAction: { kind: 'send_message', status: 'executed', messageId: 'msg-1', conversationId: 'conv-1', executedAt: '2026-09-06T10:00:00.000Z' },
        },
        outcome: {
          evaluatedAt: '2026-09-06T12:00:00.000Z',
          outcome: 'improved',
          reason: 'action_signal_positive',
          metrics: [],
          actionSignals: [{ type: 'customer_reply', outcome: 'replied', replies: 1 }],
        },
      },
      ...overrides,
    });
  }

  test('retorna aplicadas recentes com shape allowlisted (execução + outcome + sinais)', async () => {
    const recommendations = [
      appliedRecommendation({ id: 'reco-done' }),
      buildRecommendation({ id: 'reco-open', status: 'open' }),
    ];
    const { service } = buildService({ recommendations });

    const result = await service.recentRecommendationOutcomes({ tenantId: 'tenant-a' });

    expect(result).toHaveLength(1);
    const item = result[0];
    expect(item.id).toBe('reco-done');
    expect(item.executedAction.kind).toBe('send_message');
    expect(item.outcome.outcome).toBe('improved');
    expect(item.outcome.actionSignals[0].outcome).toBe('replied');
    // allowlist: sem metadata bruto
    expect(item.metadata).toBeUndefined();
    expect(Object.keys(item).sort()).toEqual([
      'appliedAt', 'executedAction', 'id', 'origin', 'outcome', 'status', 'title',
    ]);
  });

  test('ordena por appliedAt desc e limita', async () => {
    const recommendations = [
      appliedRecommendation({ id: 'reco-old', metadata: { application: { appliedAt: '2026-09-01T10:00:00.000Z' } } }),
      appliedRecommendation({ id: 'reco-new', metadata: { application: { appliedAt: '2026-09-06T10:00:00.000Z' } } }),
      appliedRecommendation({ id: 'reco-mid', metadata: { application: { appliedAt: '2026-09-03T10:00:00.000Z' } } }),
      appliedRecommendation({ id: 'reco-extra', metadata: { application: { appliedAt: '2026-09-02T10:00:00.000Z' } } }),
    ];
    const { service } = buildService({ recommendations });

    const result = await service.recentRecommendationOutcomes({ tenantId: 'tenant-a', limit: 3 });

    expect(result.map((item) => item.id)).toEqual(['reco-new', 'reco-mid', 'reco-extra']);
  });

  test('aplicada sem outcome ainda → outcome null (aguardando medição)', async () => {
    const recommendations = [
      appliedRecommendation({ id: 'reco-pending', status: 'applied', metadata: { application: { appliedAt: '2026-09-06T10:00:00.000Z', executedAction: { kind: 'create_task', status: 'executed', taskId: 't1' } } } }),
    ];
    const { service } = buildService({ recommendations });

    const result = await service.recentRecommendationOutcomes({ tenantId: 'tenant-a' });

    expect(result).toHaveLength(1);
    expect(result[0].outcome).toBeNull();
    expect(result[0].executedAction.kind).toBe('create_task');
  });

  test('sem tenantId retorna [] sem chamar o engine', async () => {
    const { service, recommendationEngine } = buildService();
    expect(await service.recentRecommendationOutcomes({})).toEqual([]);
    expect(recommendationEngine.listRecommendations).not.toHaveBeenCalled();
  });

  test('falha do engine é fail-closed ([] + warn), não derruba o Workspace', async () => {
    const { service, logger } = buildService({ engineError: new Error('db offline') });

    const result = await service.recentRecommendationOutcomes({ tenantId: 'tenant-a' });

    expect(result).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });
});
