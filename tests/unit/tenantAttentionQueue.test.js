'use strict';

/**
 * Tenant Intelligence — Gestão por exceção (getAttentionQueue):
 * fila consolidada server-side do que precisa de decisão humana agora.
 * Engines injetados como stubs (o engine orquestra, não acessa DB direto).
 */

const { TenantOperationalStateEngine } = require('../../api/core/tenant-intelligence/TenantOperationalStateEngine');

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function buildEngine({
  goals = [],
  insights = [],
  openRecommendations = [],
  completedRecommendations = [],
} = {}) {
  const goalEngine = { listGoals: jest.fn(async () => ({ items: goals })) };
  const insightEngine = { listInsights: jest.fn(async () => ({ items: insights })) };
  const recommendationEngine = {
    listRecommendations: jest.fn(async ({ status } = {}) => ({
      items: status === 'completed' ? completedRecommendations : openRecommendations,
    })),
  };
  const engine = new TenantOperationalStateEngine({
    contextResolver: {},
    goalEngine,
    metricEngine: {},
    insightEngine,
    recommendationEngine,
    evidenceEngine: {},
    marketKnowledgeService: {},
  });
  return { engine, goalEngine, insightEngine, recommendationEngine };
}

describe('TenantOperationalStateEngine.getAttentionQueue', () => {
  test('sem exceções retorna status clear ("tudo sob controle")', async () => {
    const { engine } = buildEngine();
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a' });

    expect(out.ok).toBe(true);
    expect(out.attention.status).toBe('clear');
    expect(out.attention.totalItems).toBe(0);
    expect(out.attention.items).toEqual([]);
    expect(out.attention.generatedAt).toBeTruthy();
  });

  test('recomendação open priority high vira recommendation_exception (severity high, status critical)', async () => {
    const { engine } = buildEngine({
      openRecommendations: [
        {
          id: 'reco-1',
          title: 'Redistribuir fila comercial',
          description: 'Tempo de primeira resposta subiu.',
          priority: 'high',
          status: 'open',
          created_at: daysAgo(1),
        },
      ],
    });
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a' });

    expect(out.attention.status).toBe('critical');
    expect(out.attention.totalItems).toBe(1);
    expect(out.attention.items[0]).toMatchObject({
      kind: 'recommendation_exception',
      severity: 'high',
      id: 'reco-1',
      action: { type: 'apply_recommendation', recommendationId: 'reco-1' },
    });
  });

  test('recomendação open priority medium NÃO entra na fila', async () => {
    const { engine } = buildEngine({
      openRecommendations: [
        { id: 'reco-1', title: 'Rotina', priority: 'medium', status: 'open' },
      ],
    });
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a' });
    expect(out.attention.status).toBe('clear');
  });

  test('outcome regressed recente entra; regressed fora da janela do período não entra', async () => {
    const { engine } = buildEngine({
      completedRecommendations: [
        {
          id: 'reco-recent',
          title: 'Ação recente',
          status: 'completed',
          metadata: { outcome: { outcome: 'regressed', evaluatedAt: daysAgo(2) } },
        },
        {
          id: 'reco-old',
          title: 'Ação antiga',
          status: 'completed',
          metadata: { outcome: { outcome: 'regressed', evaluatedAt: daysAgo(90) } },
        },
        {
          id: 'reco-improved',
          title: 'Ação ok',
          status: 'completed',
          metadata: { outcome: { outcome: 'improved', evaluatedAt: daysAgo(2) } },
        },
      ],
    });
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a', period: 'month' });

    const kinds = out.attention.items.map((item) => item.id);
    expect(kinds).toContain('reco-recent');
    expect(kinds).not.toContain('reco-old');
    expect(kinds).not.toContain('reco-improved');
    expect(out.attention.items[0]).toMatchObject({ kind: 'outcome_regressed', severity: 'high' });
    expect(out.attention.status).toBe('critical');
  });

  test('meta off_track entra como goal_off_track (severity medium, status attention)', async () => {
    const { engine } = buildEngine({
      goals: [
        { id: 'goal-1', name: 'Receita do mês', computed: { computedStatus: 'off_track', progressPercent: 41 } },
        { id: 'goal-2', name: 'Meta ok', computed: { computedStatus: 'on_track', progressPercent: 90 } },
      ],
    });
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a' });

    expect(out.attention.status).toBe('attention');
    expect(out.attention.totalItems).toBe(1);
    expect(out.attention.items[0]).toMatchObject({
      kind: 'goal_off_track',
      severity: 'medium',
      id: 'goal-1',
    });
    expect(out.attention.items[0].reason).toContain('41%');
  });

  test('insight high sem recomendação open entra; com recomendação open vinculada é deduplicado', async () => {
    const { engine } = buildEngine({
      insights: [
        { id: 'ins-covered', title: 'Coberto', impact: 'high', status: 'open' },
        { id: 'ins-solo', title: 'Sozinho', impact: 'high', status: 'open', description: 'Queda relevante.' },
        { id: 'ins-low', title: 'Baixo', impact: 'low', status: 'open' },
      ],
      openRecommendations: [
        { id: 'reco-1', title: 'Ação', priority: 'medium', status: 'open', insight_id: 'ins-covered' },
      ],
    });
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a' });

    const ids = out.attention.items.map((item) => item.id);
    expect(ids).toContain('ins-solo');
    expect(ids).not.toContain('ins-covered');
    expect(ids).not.toContain('ins-low');
    expect(out.attention.items[0]).toMatchObject({ kind: 'insight_high', severity: 'medium' });
  });

  test('dedupe goal↔insight: insight da mesma meta off_track não duplica a exceção', async () => {
    const { engine } = buildEngine({
      goals: [
        { id: 'goal-1', name: 'Receita', computed: { computedStatus: 'off_track', progressPercent: 20 } },
      ],
      insights: [
        {
          id: 'ins-goal',
          title: 'Meta fora do esperado: Receita',
          impact: 'high',
          status: 'open',
          metadata: { goalId: 'goal-1' },
        },
      ],
    });
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a' });

    expect(out.attention.totalItems).toBe(1);
    expect(out.attention.items[0]).toMatchObject({ kind: 'goal_off_track', id: 'goal-1' });
  });

  test('dedupe de título: insights repetidos viram uma única interrupção', async () => {
    const { engine } = buildEngine({
      insights: [
        { id: 'ins-1', title: 'Concentracao de eventos em X', impact: 'high', status: 'open' },
        { id: 'ins-2', title: 'Concentracao de eventos em X', impact: 'high', status: 'open' },
        { id: 'ins-3', title: 'Outro sinal', impact: 'high', status: 'open' },
      ],
    });
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a' });

    expect(out.attention.totalItems).toBe(2);
    const ids = out.attention.items.map((item) => item.id);
    expect(ids).toContain('ins-3');
    expect(ids.filter((id) => id === 'ins-1' || id === 'ins-2')).toHaveLength(1);
  });

  test('ordena severity high antes de medium', async () => {
    const { engine } = buildEngine({
      goals: [
        { id: 'goal-1', name: 'Meta', computed: { computedStatus: 'off_track', progressPercent: 10 } },
      ],
      openRecommendations: [
        { id: 'reco-high', title: 'Alta', priority: 'high', status: 'open', created_at: daysAgo(5) },
      ],
    });
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a' });

    expect(out.attention.items.map((item) => item.severity)).toEqual(['high', 'medium']);
  });

  test('respeita o cap de itens (options.limit)', async () => {
    const { engine } = buildEngine({
      openRecommendations: [
        { id: 'r1', title: 'A', priority: 'high', status: 'open', created_at: daysAgo(1) },
        { id: 'r2', title: 'B', priority: 'high', status: 'open', created_at: daysAgo(2) },
        { id: 'r3', title: 'C', priority: 'high', status: 'open', created_at: daysAgo(3) },
      ],
    });
    const out = await engine.getAttentionQueue({ tenantId: 'tenant-a', options: { limit: 2 } });

    expect(out.attention.totalItems).toBe(2);
    expect(out.attention.items).toHaveLength(2);
  });

  test('exige tenantId', async () => {
    const { engine } = buildEngine();
    await expect(engine.getAttentionQueue({})).rejects.toThrow('tenantId is required');
  });
});
