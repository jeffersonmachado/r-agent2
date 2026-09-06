'use strict';

/**
 * Phase 5 — Tenant Intelligence Core
 * Unit tests for engines and helpers (no DB / no HTTP layer).
 */

const { buildId, toNumber, parsePeriod, resolvePeriodBounds, dateOnlyString } = require('../../api/core/tenant-intelligence/helpers');
const { GoalEngine } = require('../../api/core/tenant-intelligence/GoalEngine');
const { RecommendationEngine } = require('../../api/core/tenant-intelligence/RecommendationEngine');
const { EvidenceEngine } = require('../../api/core/tenant-intelligence/EvidenceEngine');
const { InsightEngine } = require('../../api/core/tenant-intelligence/InsightEngine');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
describe('helpers', () => {
  describe('buildId', () => {
    test('gera string com prefixo, timestamp e hex', () => {
      const id = buildId('goal');
      expect(id).toMatch(/^goal-\d+-[0-9a-f]{12}$/);
    });

    test('dois IDs seguidos sao diferentes', () => {
      const a = buildId('x');
      const b = buildId('x');
      expect(a).not.toBe(b);
    });
  });

  describe('toNumber', () => {
    test('converte string numerica', () => {
      expect(toNumber('42')).toBe(42);
    });

    test('retorna fallback para valor nao numerico', () => {
      expect(toNumber('abc', -1)).toBe(-1);
    });

    test('retorna fallback para null', () => {
      expect(toNumber(null, 0)).toBe(0);
    });

    test('retorna fallback para undefined', () => {
      expect(toNumber(undefined, 5)).toBe(5);
    });

    test('converte float', () => {
      expect(toNumber(3.14)).toBe(3.14);
    });
  });

  describe('parsePeriod', () => {
    test.each(['day', 'week', 'month', 'quarter', 'year', 'custom'])('aceita periodo %s', (period) => {
      expect(parsePeriod(period)).toBe(period);
    });

    test('retorna month para valor desconhecido', () => {
      expect(parsePeriod('bimestre')).toBe('month');
    });

    test('retorna month para nulo', () => {
      expect(parsePeriod(null)).toBe('month');
    });
  });

  describe('resolvePeriodBounds', () => {
    test('retorna objecto com start e end para month', () => {
      const bounds = resolvePeriodBounds('month');
      expect(bounds.type).toBe('month');
      expect(bounds.start).toBeInstanceOf(Date);
      expect(bounds.end).toBeInstanceOf(Date);
      expect(bounds.start.getTime()).toBeLessThan(bounds.end.getTime());
    });

    test('start de month eh ~30 dias antes do end', () => {
      const bounds = resolvePeriodBounds('month');
      const diffMs = bounds.end.getTime() - bounds.start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(27);
      expect(diffDays).toBeLessThan(33);
    });

    test('start de year eh ~365 dias antes do end', () => {
      const bounds = resolvePeriodBounds('year');
      const diffDays = (bounds.end.getTime() - bounds.start.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(360);
      expect(diffDays).toBeLessThan(370);
    });

    test('custom usa datas fornecidas', () => {
      const start = new Date('2025-01-01T00:00:00Z');
      const end = new Date('2025-03-31T00:00:00Z');
      const bounds = resolvePeriodBounds('custom', { start, end });
      expect(bounds.type).toBe('custom');
      expect(bounds.start.toISOString()).toBe(start.toISOString());
      expect(bounds.end.toISOString()).toBe(end.toISOString());
    });

    test('custom invalido cai para month', () => {
      const bounds = resolvePeriodBounds('custom', { start: 'nope', end: 'nope' });
      expect(bounds.type).toBe('month');
    });
  });

  describe('dateOnlyString', () => {
    test('retorna YYYY-MM-DD de um Date', () => {
      const result = dateOnlyString(new Date('2025-06-15T12:00:00Z'));
      expect(result).toBe('2025-06-15');
    });

    test('retorna YYYY-MM-DD de uma string de data', () => {
      const result = dateOnlyString('2025-06-15T12:00:00Z');
      expect(result).toBe('2025-06-15');
    });

    test('retorna null para data invalida', () => {
      expect(dateOnlyString('nao-e-data')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// GoalEngine.evaluateGoalStatus (pure, no DB)
// ---------------------------------------------------------------------------
describe('GoalEngine.evaluateGoalStatus', () => {
  const engine = new GoalEngine();

  test('on_track quando current >= target (gte)', () => {
    const result = engine.evaluateGoalStatus({
      target_value: 80,
      current_value: 90,
      comparison_mode: 'gte',
    });
    expect(result.computedStatus).toBe('on_track');
    expect(result.progressPercent).toBeGreaterThanOrEqual(100);
    expect(result.delta).toBeCloseTo(10);
  });

  test('off_track quando current < target (gte)', () => {
    const result = engine.evaluateGoalStatus({
      target_value: 80,
      current_value: 50,
      comparison_mode: 'gte',
    });
    expect(result.computedStatus).toBe('off_track');
    expect(result.progressPercent).toBeLessThan(90);
  });

  test('at_risk quando entre 90-99% do alvo (gte)', () => {
    const result = engine.evaluateGoalStatus({
      target_value: 100,
      current_value: 92,
      comparison_mode: 'gte',
    });
    expect(result.computedStatus).toBe('at_risk');
    expect(result.progressPercent).toBeGreaterThanOrEqual(90);
    expect(result.progressPercent).toBeLessThan(100);
  });

  test('on_track quando current <= target (lte)', () => {
    const result = engine.evaluateGoalStatus({
      target_value: 5,
      current_value: 3,
      comparison_mode: 'lte',
    });
    expect(result.computedStatus).toBe('on_track');
  });

  test('off_track quando current > target (lte)', () => {
    const result = engine.evaluateGoalStatus({
      target_value: 5,
      current_value: 20,
      comparison_mode: 'lte',
    });
    expect(result.computedStatus).toBe('off_track');
  });

  test('on_track para mode eq quando values iguais', () => {
    const result = engine.evaluateGoalStatus({
      target_value: 10,
      current_value: 10,
      comparison_mode: 'eq',
    });
    expect(result.computedStatus).toBe('on_track');
  });

  test('unknown quando current_value eh null', () => {
    const result = engine.evaluateGoalStatus({
      target_value: 80,
      current_value: null,
      comparison_mode: 'gte',
    });
    expect(result.computedStatus).toBe('unknown');
    expect(result.progressPercent).toBeNull();
    expect(result.delta).toBeNull();
  });

  test('unknown quando target_value eh 0', () => {
    const result = engine.evaluateGoalStatus({
      target_value: 0,
      current_value: 10,
      comparison_mode: 'gte',
    });
    expect(result.computedStatus).toBe('unknown');
  });

  test('progressPercent fica entre 0 e 100', () => {
    const result = engine.evaluateGoalStatus({
      target_value: 10,
      current_value: 0,
      comparison_mode: 'gte',
    });
    expect(result.progressPercent).toBeGreaterThanOrEqual(0);
    expect(result.progressPercent).toBeLessThanOrEqual(100);
  });

  test('nao lanca excecao para goal com campos ausentes', () => {
    expect(() => engine.evaluateGoalStatus({})).not.toThrow();
    expect(() => engine.evaluateGoalStatus(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// GoalEngine.createGoal / listGoals / updateGoal — mocked DB
// ---------------------------------------------------------------------------
describe('GoalEngine — operacoes com DB mockado', () => {
  function buildMockGoalModel(store = []) {
    return {
      create: jest.fn(async (data) => {
        const record = { ...data };
        store.push(record);
        return { toJSON: () => record };
      }),
      findAll: jest.fn(async ({ where, limit } = {}) => {
        const filtered = store.filter((item) => {
          if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
          if (where?.status && item.status !== where.status) return false;
          return true;
        });
        return filtered.slice(0, limit || 100).map((item) => ({ toJSON: () => item }));
      }),
      findOne: jest.fn(async ({ where } = {}) => {
        const found = store.find((item) => {
          if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
          if (where?.id && item.id !== where.id) return false;
          return true;
        });
        if (!found) return null;
        const mutable = { ...found };
        return {
          toJSON: () => mutable,
          update: jest.fn(async (patch) => Object.assign(found, mutable, patch)),
        };
      }),
    };
  }

  beforeEach(() => {
    jest.resetModules();
  });

  test('createGoal insere e retorna com evaluation', async () => {
    const store = [];
    const mock = buildMockGoalModel(store);

    jest.doMock('../../api/db/models', () => ({
      TenantGoal: () => mock,
    }));

    const { GoalEngine: GoalEngineInjected } = require('../../api/core/tenant-intelligence/GoalEngine');
    const eng = new GoalEngineInjected();

    const result = await eng.createGoal({
      tenantId: 'tenant-a',
      payload: {
        name: 'Aumentar NPS',
        metric_key: 'nps.score',
        target_value: 70,
        current_value: 60,
        comparison_mode: 'gte',
      },
    });

    expect(result.goal.name).toBe('Aumentar NPS');
    expect(result.goal.tenant_key).toBe('tenant-a');
    expect(result.evaluation.computedStatus).toBe('off_track');
    expect(store).toHaveLength(1);
  });

  test('createGoal lanca excecao sem name', async () => {
    const mock = buildMockGoalModel([]);
    jest.doMock('../../api/db/models', () => ({ TenantGoal: () => mock }));
    const { GoalEngine: GoalEngineInjected } = require('../../api/core/tenant-intelligence/GoalEngine');
    const eng = new GoalEngineInjected();
    await expect(eng.createGoal({ tenantId: 'x', payload: { metric_key: 'k', target_value: 1 } }))
      .rejects.toThrow('required');
  });

  test('createGoal lanca excecao sem tenantId', async () => {
    const mock = buildMockGoalModel([]);
    jest.doMock('../../api/db/models', () => ({ TenantGoal: () => mock }));
    const { GoalEngine: GoalEngineInjected } = require('../../api/core/tenant-intelligence/GoalEngine');
    const eng = new GoalEngineInjected();
    await expect(eng.createGoal({ payload: { name: 'n', metric_key: 'k', target_value: 1 } }))
      .rejects.toThrow('tenantId is required');
  });

  test('listGoals retorna items filtrados por status', async () => {
    const store = [
      { id: 'g1', tenant_key: 't1', status: 'active', target_value: 5, current_value: 3, comparison_mode: 'gte' },
      { id: 'g2', tenant_key: 't1', status: 'inactive', target_value: 5, current_value: 3, comparison_mode: 'gte' },
    ];
    const mock = buildMockGoalModel(store);
    jest.doMock('../../api/db/models', () => ({ TenantGoal: () => mock }));
    const { GoalEngine: GoalEngineInjected } = require('../../api/core/tenant-intelligence/GoalEngine');
    const eng = new GoalEngineInjected();

    const result = await eng.listGoals({ tenantId: 't1', status: 'active' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('g1');
    expect(result.items[0].computed).toBeDefined();
  });

  test('updateGoal retorna goal_not_found para id inexistente', async () => {
    const mock = buildMockGoalModel([]);
    jest.doMock('../../api/db/models', () => ({ TenantGoal: () => mock }));
    const { GoalEngine: GoalEngineInjected } = require('../../api/core/tenant-intelligence/GoalEngine');
    const eng = new GoalEngineInjected();
    const result = await eng.updateGoal({ tenantId: 't1', goalId: 'nope', updates: { status: 'inactive' } });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('goal_not_found');
  });
});

// ---------------------------------------------------------------------------
// RecommendationEngine._mapInsightToRecommendation (pure)
// ---------------------------------------------------------------------------
describe('RecommendationEngine._mapInsightToRecommendation', () => {
  const engine = new RecommendationEngine();

  const baseInsight = (type, extra = {}) => ({
    id: `insight-${type}`,
    type,
    related_metrics: ['some.metric'],
    metadata: {},
    ...extra,
  });

  test.each([
    ['goal_off_track', 'operational_review'],
    ['event_concentration', 'investigate_concentration'],
    ['metric_drop', 'investigate_metric_drop'],
    ['metric_increase', 'validate_metric_increase'],
    ['goal_at_risk', 'preventive_action'],
    ['unknown_type', 'human_review'],
  ])('tipo %s mapeia para actionType %s', (insightType, expectedAction) => {
    const result = engine._mapInsightToRecommendation(baseInsight(insightType), []);
    expect(result).not.toBeNull();
    expect(result.actionType).toBe(expectedAction);
    expect(result.insightId).toBe(`insight-${insightType}`);
  });

  test('retorna null para insight sem id', () => {
    const result = engine._mapInsightToRecommendation({ type: 'goal_off_track' }, []);
    expect(result).toBeNull();
  });

  test('preenche goalId quando goal correspondente existe', () => {
    const insight = {
      id: 'ins-1',
      type: 'goal_off_track',
      related_metrics: [],
      metadata: { goalId: 'gx' },
    };
    const goals = [{ id: 'gx', priority: 'high' }];
    const result = engine._mapInsightToRecommendation(insight, goals);
    expect(result.goalId).toBe('gx');
    expect(result.priority).toBe('high');
  });

  test('tem titulo e descricao nao vazios para todos os tipos conhecidos', () => {
    const types = ['goal_off_track', 'event_concentration', 'metric_drop', 'metric_increase', 'goal_at_risk'];
    for (const type of types) {
      const result = engine._mapInsightToRecommendation(baseInsight(type), []);
      expect(typeof result.title).toBe('string');
      expect(result.title.length).toBeGreaterThan(5);
      expect(typeof result.description).toBe('string');
      expect(result.description.length).toBeGreaterThan(10);
    }
  });
});

// ---------------------------------------------------------------------------
// EvidenceEngine — mocked DB
// ---------------------------------------------------------------------------
describe('EvidenceEngine — operacoes com DB mockado', () => {
  function buildMockEvidenceModel(store = []) {
    return {
      create: jest.fn(async (data) => {
        const record = { ...data };
        store.push(record);
        return { toJSON: () => record };
      }),
      findAll: jest.fn(async ({ where, limit } = {}) => {
        const filtered = store.filter((item) => {
          if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
          if (where?.insight_id && item.insight_id !== where.insight_id) return false;
          return true;
        });
        return filtered.slice(0, limit || 100).map((item) => ({ toJSON: () => item }));
      }),
    };
  }

  beforeEach(() => {
    jest.resetModules();
  });

  test('createEvidence persiste e retorna evidencia', async () => {
    const store = [];
    const mock = buildMockEvidenceModel(store);
    jest.doMock('../../api/db/models', () => ({ TenantInsightEvidence: () => mock }));
    const { EvidenceEngine: EvidenceEngineInjected } = require('../../api/core/tenant-intelligence/EvidenceEngine');
    const eng = new EvidenceEngineInjected();

    const result = await eng.createEvidence({
      tenantId: 'tenant-b',
      insightId: 'ins-1',
      evidenceType: 'metric_snapshot',
      sourceType: 'tenant_metric_snapshot',
      sourceId: 'snap-7',
      excerpt: 'Queda de 30%.',
      structuredData: { metric_key: 'orders.cancel_rate', value: 0.08 },
    });

    expect(result.insight_id).toBe('ins-1');
    expect(result.evidence_type).toBe('metric_snapshot');
    expect(result.source_type).toBe('tenant_metric_snapshot');
    expect(result.structured_data.metric_key).toBe('orders.cancel_rate');
    expect(store).toHaveLength(1);
  });

  test('createEvidence lanca excecao sem campos obrigatorios', async () => {
    const mock = buildMockEvidenceModel([]);
    jest.doMock('../../api/db/models', () => ({ TenantInsightEvidence: () => mock }));
    const { EvidenceEngine: EvidenceEngineInjected } = require('../../api/core/tenant-intelligence/EvidenceEngine');
    const eng = new EvidenceEngineInjected();
    await expect(eng.createEvidence({ tenantId: 't', insightId: 'i' }))
      .rejects.toThrow('required');
  });

  test('listByInsight retorna items somente do insight passado', async () => {
    const store = [
      { id: 'ev1', tenant_key: 't1', insight_id: 'ins-A', evidence_type: 'metric_snapshot', source_type: 'snap' },
      { id: 'ev2', tenant_key: 't1', insight_id: 'ins-B', evidence_type: 'metric_snapshot', source_type: 'snap' },
    ];
    const mock = buildMockEvidenceModel(store);
    jest.doMock('../../api/db/models', () => ({ TenantInsightEvidence: () => mock }));
    const { EvidenceEngine: EvidenceEngineInjected } = require('../../api/core/tenant-intelligence/EvidenceEngine');
    const eng = new EvidenceEngineInjected();

    const result = await eng.listByInsight({ tenantId: 't1', insightId: 'ins-A' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('ev1');
  });

  test('listByInsight lanca excecao sem tenantId', async () => {
    const mock = buildMockEvidenceModel([]);
    jest.doMock('../../api/db/models', () => ({ TenantInsightEvidence: () => mock }));
    const { EvidenceEngine: EvidenceEngineInjected } = require('../../api/core/tenant-intelligence/EvidenceEngine');
    const eng = new EvidenceEngineInjected();
    await expect(eng.listByInsight({ insightId: 'i' })).rejects.toThrow('required');
  });
});

// ---------------------------------------------------------------------------
// InsightEngine — snapshot reuse and refresh control
// ---------------------------------------------------------------------------
describe('InsightEngine — controle de refresh de metricas', () => {
  test('reaproveita snapshots fornecidos e nao chama collectSnapshots', async () => {
    const metricEngine = {
      collectSnapshots: jest.fn(async () => ({ ok: true, snapshots: [] })),
    };
    const goalEngine = {
      listGoals: jest.fn(async () => ({ items: [], total: 0 })),
    };

    const engine = new InsightEngine({ metricEngine, goalEngine });
    const snapshots = [
      { id: 's-prev', metric_key: 'event_ledger.total_events', value: 100, period_end: '2026-03-01T00:00:00.000Z' },
      { id: 's-latest', metric_key: 'event_ledger.total_events', value: 70, period_end: '2026-03-31T00:00:00.000Z' },
    ];

    const out = await engine.generateInsights({
      tenantId: 'tenant-1',
      persist: false,
      snapshots,
      refreshMetrics: true,
    });

    expect(metricEngine.collectSnapshots).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.insights.some((item) => item.type === 'metric_drop')).toBe(true);
  });

  test('com refreshMetrics=false nao chama collectSnapshots mesmo sem snapshots fornecidos', async () => {
    const metricEngine = {
      collectSnapshots: jest.fn(async () => ({ ok: true, snapshots: [] })),
    };
    const goalEngine = {
      listGoals: jest.fn(async () => ({ items: [], total: 0 })),
    };

    const engine = new InsightEngine({ metricEngine, goalEngine });
    jest.spyOn(engine, '_loadRecentSnapshotsByMetric').mockResolvedValue(new Map());

    const out = await engine.generateInsights({
      tenantId: 'tenant-1',
      persist: false,
      refreshMetrics: false,
    });

    expect(metricEngine.collectSnapshots).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.insights).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// InsightEngine — Explanation (causas provaveis) e Prediction (projecao de meta)
// ---------------------------------------------------------------------------
describe('InsightEngine — explanation e prediction', () => {
  function buildDeps({ goals = [] } = {}) {
    return {
      metricEngine: { collectSnapshots: jest.fn(async () => ({ ok: true, snapshots: [] })) },
      goalEngine: { listGoals: jest.fn(async () => ({ items: goals, total: goals.length })) },
    };
  }

  function snap(id, metricKey, value, periodEnd) {
    return { id, metric_key: metricKey, value, period_end: periodEnd };
  }

  test('metric_drop inclui causas provaveis ordenadas por magnitude (e exclui variacao < 15%)', async () => {
    const engine = new InsightEngine(buildDeps());
    const snapshots = [
      snap('a-prev', 'operations.tickets_open', 100, '2026-03-01T00:00:00.000Z'),
      snap('a-latest', 'operations.tickets_open', 60, '2026-03-31T00:00:00.000Z'),
      snap('b-prev', 'operations.abandonment_rate_pct', 10, '2026-03-01T00:00:00.000Z'),
      snap('b-latest', 'operations.abandonment_rate_pct', 14, '2026-03-31T00:00:00.000Z'),
      snap('c-prev', 'operations.tickets_closed', 50, '2026-03-01T00:00:00.000Z'),
      snap('c-latest', 'operations.tickets_closed', 38, '2026-03-31T00:00:00.000Z'),
      snap('d-prev', 'operations.avg_response_minutes', 20, '2026-03-01T00:00:00.000Z'),
      snap('d-latest', 'operations.avg_response_minutes', 21, '2026-03-31T00:00:00.000Z'),
    ];

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, snapshots });

    const drop = out.insights.find((item) => item.type === 'metric_drop' && item.relatedMetrics[0] === 'operations.tickets_open');
    expect(drop).toBeTruthy();
    expect(drop.metadata.probableCauses).toEqual([
      { metricKey: 'operations.abandonment_rate_pct', label: 'taxa de abandono', changeRatio: 0.4, direction: 'up' },
      { metricKey: 'operations.tickets_closed', label: 'operations tickets closed', changeRatio: -0.24, direction: 'down' },
    ]);
    expect(drop.description).toContain('Possiveis causas no mesmo periodo: taxa de abandono (+40%), operations tickets closed (-24%)');
  });

  test('causas provaveis limitadas a 3 e excluem a propria metrica', async () => {
    const engine = new InsightEngine(buildDeps());
    const snapshots = [
      snap('a-prev', 'm.main', 100, '2026-03-01T00:00:00.000Z'),
      snap('a-latest', 'm.main', 50, '2026-03-31T00:00:00.000Z'),
      snap('b-prev', 'm.c1', 10, '2026-03-01T00:00:00.000Z'),
      snap('b-latest', 'm.c1', 20, '2026-03-31T00:00:00.000Z'),
      snap('c-prev', 'm.c2', 10, '2026-03-01T00:00:00.000Z'),
      snap('c-latest', 'm.c2', 18, '2026-03-31T00:00:00.000Z'),
      snap('d-prev', 'm.c3', 10, '2026-03-01T00:00:00.000Z'),
      snap('d-latest', 'm.c3', 16, '2026-03-31T00:00:00.000Z'),
      snap('e-prev', 'm.c4', 10, '2026-03-01T00:00:00.000Z'),
      snap('e-latest', 'm.c4', 14, '2026-03-31T00:00:00.000Z'),
    ];

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, snapshots });

    const drop = out.insights.find((item) => item.relatedMetrics[0] === 'm.main');
    expect(drop.metadata.probableCauses).toHaveLength(3);
    expect(drop.metadata.probableCauses.map((c) => c.metricKey)).toEqual(['m.c1', 'm.c2', 'm.c3']);
    expect(drop.metadata.probableCauses.some((c) => c.metricKey === 'm.main')).toBe(false);
  });

  test('insight sem outras metricas em movimento nao carrega probableCauses', async () => {
    const engine = new InsightEngine(buildDeps());
    const snapshots = [
      snap('a-prev', 'operations.tickets_open', 100, '2026-03-01T00:00:00.000Z'),
      snap('a-latest', 'operations.tickets_open', 60, '2026-03-31T00:00:00.000Z'),
    ];

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, snapshots });

    const drop = out.insights.find((item) => item.type === 'metric_drop');
    expect(drop).toBeTruthy();
    expect(drop.metadata.probableCauses).toBeUndefined();
    expect(drop.description).not.toContain('Possiveis causas');
  });

  test('meta off_track no meio da janela recebe projecao will_miss', async () => {
    const now = Date.now();
    const goal = {
      id: 'goal-1',
      name: 'Fechar 10 tickets',
      metric_key: 'tickets_closed',
      target_value: 10,
      current_value: 3,
      comparison_mode: 'gte',
      priority: 'high',
      start_date: new Date(now - 15 * 86400000).toISOString(),
      end_date: new Date(now + 15 * 86400000).toISOString(),
      computed: { computedStatus: 'off_track', progressPercent: 30, delta: -7 },
    };
    const engine = new InsightEngine(buildDeps({ goals: [goal] }));
    jest.spyOn(engine, '_loadRecentSnapshotsByMetric').mockResolvedValue(new Map());

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, refreshMetrics: false });

    const insight = out.insights.find((item) => item.type === 'goal_off_track');
    expect(insight).toBeTruthy();
    expect(insight.metadata.projection.projectedStatus).toBe('will_miss');
    expect(insight.metadata.projection.projectedValue).toBeCloseTo(6, 1);
    expect(insight.metadata.projection.targetValue).toBe(10);
    expect(insight.metadata.projection.elapsedFraction).toBeCloseTo(0.5, 1);
    expect(insight.description).toContain('Projecao: no ritmo atual');
    expect(insight.description).toContain('nao atinge a meta');
  });

  test('projecao will_meet quando o ritmo supera o alvo (modo lte)', async () => {
    const now = Date.now();
    const goal = {
      id: 'goal-2',
      name: 'Manter abandono <= 20',
      metric_key: 'abandonment',
      target_value: 20,
      current_value: 4,
      comparison_mode: 'lte',
      priority: 'medium',
      start_date: new Date(now - 15 * 86400000).toISOString(),
      end_date: new Date(now + 15 * 86400000).toISOString(),
      computed: { computedStatus: 'at_risk', progressPercent: 90, delta: -1 },
    };
    const engine = new InsightEngine(buildDeps({ goals: [goal] }));
    jest.spyOn(engine, '_loadRecentSnapshotsByMetric').mockResolvedValue(new Map());

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, refreshMetrics: false });

    const insight = out.insights.find((item) => item.type === 'goal_at_risk');
    expect(insight.metadata.projection.projectedStatus).toBe('will_meet');
    expect(insight.metadata.projection.projectedValue).toBeCloseTo(8, 1);
  });

  test('sem janela valida ou modo eq nao projeta', async () => {
    const now = Date.now();
    const base = {
      metric_key: 'tickets_closed',
      target_value: 10,
      current_value: 3,
      priority: 'high',
      computed: { computedStatus: 'off_track', progressPercent: 30, delta: -7 },
    };
    const goals = [
      { ...base, id: 'goal-sem-janela', name: 'Sem janela', comparison_mode: 'gte' },
      {
        ...base,
        id: 'goal-eq',
        name: 'Modo eq',
        comparison_mode: 'eq',
        start_date: new Date(now - 15 * 86400000).toISOString(),
        end_date: new Date(now + 15 * 86400000).toISOString(),
      },
    ];
    const engine = new InsightEngine(buildDeps({ goals }));
    jest.spyOn(engine, '_loadRecentSnapshotsByMetric').mockResolvedValue(new Map());

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, refreshMetrics: false });

    expect(out.insights).toHaveLength(2);
    for (const insight of out.insights) {
      expect(insight.metadata.projection).toBeUndefined();
      expect(insight.description).not.toContain('Projecao:');
    }
  });
});

// ---------------------------------------------------------------------------
describe('InsightEngine — linguagem outcome-first', () => {
  function buildDeps({ goals = [] } = {}) {
    return {
      metricEngine: { collectSnapshots: jest.fn(async () => ({ ok: true, snapshots: [] })) },
      goalEngine: { listGoals: jest.fn(async () => ({ items: goals, total: goals.length })) },
    };
  }

  function snap(id, metricKey, value, periodEnd, metadata) {
    return { id, metric_key: metricKey, value, period_end: periodEnd, metadata };
  }

  test('trend insight usa rótulo de negócio no título e na descrição (nunca a chave crua)', async () => {
    const engine = new InsightEngine(buildDeps());
    const snapshots = [
      snap('a-prev', 'operations.tickets_open', 100, '2026-03-01T00:00:00.000Z'),
      snap('a-latest', 'operations.tickets_open', 50, '2026-03-31T00:00:00.000Z'),
    ];

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, snapshots });

    const drop = out.insights.find((item) => item.type === 'metric_drop');
    expect(drop).toBeTruthy();
    expect(drop.title).toBe('queda relevante em atendimentos em aberto');
    expect(drop.description).toContain('O indicador atendimentos em aberto variou -50%');
    expect(drop.title).not.toContain('operations.tickets_open');
    expect(drop.description).not.toContain('operations.tickets_open');
    // Campo de máquina mantém a chave bruta para rastreabilidade.
    expect(drop.relatedMetrics).toEqual(['operations.tickets_open']);
  });

  test('trend insight com chave desconhecida humaniza em vez de expor o identificador', async () => {
    const engine = new InsightEngine(buildDeps());
    const snapshots = [
      snap('a-prev', 'orders.created_count', 100, '2026-03-01T00:00:00.000Z'),
      snap('a-latest', 'orders.created_count', 150, '2026-03-31T00:00:00.000Z'),
    ];

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, snapshots });

    const rise = out.insights.find((item) => item.type === 'metric_increase');
    expect(rise.title).toBe('aumento relevante em orders created count');
    expect(rise.title).not.toContain('orders.created_count');
  });

  test('event_concentration traduz o tipo técnico do evento', async () => {
    const engine = new InsightEngine(buildDeps());
    const snapshots = [
      snap('top-1', 'event_ledger.top_type_ratio', 0.94, '2026-03-31T00:00:00.000Z', {
        topType: 'ScheduledTriggerFired',
        topTypeCount: 470,
        total: 500,
      }),
    ];

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, snapshots });

    const concentration = out.insights.find((item) => item.type === 'event_concentration');
    expect(concentration).toBeTruthy();
    expect(concentration.title).toBe('Concentracao de eventos em rotinas automáticas programadas');
    expect(concentration.description).toContain('94% dos eventos em rotinas automáticas programadas');
    expect(concentration.title).not.toContain('ScheduledTriggerFired');
    expect(concentration.description).not.toContain('ScheduledTriggerFired');
    // metadata técnica preservada para diagnóstico.
    expect(concentration.metadata.topType).toBe('ScheduledTriggerFired');
  });

  test('causas prováveis carregam label e a descrição não expõe chaves cruas', async () => {
    const engine = new InsightEngine(buildDeps());
    const snapshots = [
      snap('a-prev', 'conversion_rate', 50, '2026-03-01T00:00:00.000Z'),
      snap('a-latest', 'conversion_rate', 30, '2026-03-31T00:00:00.000Z'),
      snap('b-prev', 'operations.avg_first_response_minutes', 10, '2026-03-01T00:00:00.000Z'),
      snap('b-latest', 'operations.avg_first_response_minutes', 15, '2026-03-31T00:00:00.000Z'),
    ];

    const out = await engine.generateInsights({ tenantId: 'tenant-1', persist: false, snapshots });

    const drop = out.insights.find((item) => item.type === 'metric_drop');
    expect(drop.title).toBe('queda relevante em taxa de conversão');
    const causes = drop.metadata.probableCauses;
    expect(causes).toHaveLength(1);
    expect(causes[0]).toMatchObject({
      metricKey: 'operations.avg_first_response_minutes',
      label: 'tempo médio de primeira resposta',
    });
    expect(drop.description).toContain('tempo médio de primeira resposta (+50%)');
    expect(drop.description).not.toContain('operations.avg_first_response_minutes');
  });
});
