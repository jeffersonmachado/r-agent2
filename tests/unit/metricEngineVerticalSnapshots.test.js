'use strict';

/**
 * MetricEngine — snapshots de KPIs verticais de negocio (vertical.*).
 *
 * Garante que os indicadores das verticais ativas do tenant (no-show,
 * retorno, churn de assinaturas) entram no snapshot imutavel e fluem pelo
 * loop Decision Intelligence (insight -> recomendacao -> acao -> outcome).
 * DB e servicos mockados (sem Postgres/Redis).
 */

function loadEngine({
  membershipVerticals = [],
  attendanceVerticals = [],
  verticalMetrics = {},
  verticalMetricsError = null,
} = {}) {
  jest.resetModules();

  const createdRows = [];
  jest.doMock('../../api/db/models', () => ({
    TenantMetricSnapshot: () => ({
      create: jest.fn(async (data) => {
        createdRows.push(data);
        return { toJSON: () => data };
      }),
    }),
    // Consumido pelo hook de outcome (evaluatePendingOutcomes) via RecommendationEngine
    TenantRecommendation: () => ({
      findAll: jest.fn(async () => []),
    }),
    TenantInsight: () => ({
      findOne: jest.fn(async () => null),
    }),
    AccessMembership: () => ({
      findAll: jest.fn(async () => membershipVerticals.map((vertical) => ({ toJSON: () => ({ vertical }) }))),
    }),
    VerticalAttendance: () => ({
      findAll: jest.fn(async () => attendanceVerticals.map((vertical) => ({ toJSON: () => ({ vertical }) }))),
    }),
  }));

  jest.doMock('../../api/db/sequelize', () => ({
    getSequelize: () => null,
  }));

  jest.doMock('../../api/services/eventLedgerMetricsService', () => ({
    getEventLedgerMetrics: jest.fn(async () => ({
      ok: true,
      metrics: {
        total: 10,
        recent: 3,
        dispatch: { summary: { pending: 1, dead: 0, doneRecent: 2 } },
      },
    })),
  }));

  jest.doMock('../../api/services/analyticsService', () => ({
    getGeneralMetrics: jest.fn(async () => null),
  }));

  jest.doMock('../../api/services/vertical/verticalMetricsEngine', () => ({
    computeVerticalMetrics: jest.fn(async ({ vertical }) => {
      if (verticalMetricsError) throw verticalMetricsError;
      return verticalMetrics[vertical] || null;
    }),
  }));

  // eslint-disable-next-line global-require
  const { MetricEngine } = require('../../api/core/tenant-intelligence/MetricEngine');
  return { engine: new MetricEngine(), createdRows };
}

const beautyMetrics = {
  attendance: { total: 40, noShowRate: 0.25, returnRate: 0.5 },
  membership: { active: 33, churnRate: 0.1212 },
  revenue: { activeSubscriptions: 21 },
};

describe('MetricEngine.collectSnapshots — KPIs verticais', () => {
  test('persiste chaves vertical.<v>.* com source vertical e taxas em %', async () => {
    const { engine, createdRows } = loadEngine({
      membershipVerticals: ['beauty'],
      verticalMetrics: { beauty: beautyMetrics },
    });

    const result = await engine.collectSnapshots({ tenantId: 'tenant-1', period: 'month' });

    expect(result.ok).toBe(true);
    expect(result.warnings).toBeUndefined();

    const byKey = Object.fromEntries(createdRows.map((row) => [row.metric_key, row]));
    expect(byKey['vertical.beauty.attendances_total'].value).toBe(40);
    expect(byKey['vertical.beauty.attendances_total'].source).toBe('vertical');
    // Fracoes 0..1 convertidas para percentual com 2 casas
    expect(byKey['vertical.beauty.no_show_rate_pct'].value).toBe(25);
    expect(byKey['vertical.beauty.return_rate_pct'].value).toBe(50);
    expect(byKey['vertical.beauty.memberships_active'].value).toBe(33);
    expect(byKey['vertical.beauty.churn_rate_pct'].value).toBe(12.12);
    expect(byKey['vertical.beauty.active_subscriptions'].value).toBe(21);

    // Metricas do event ledger preservadas
    expect(byKey['event_ledger.total_events'].value).toBe(10);
  });

  test('descobre verticais por assinatura e por comparecimento (uniao)', async () => {
    const { engine, createdRows } = loadEngine({
      membershipVerticals: ['beauty'],
      attendanceVerticals: ['fitness'],
      verticalMetrics: { beauty: beautyMetrics, fitness: beautyMetrics },
    });

    const result = await engine.collectSnapshots({ tenantId: 'tenant-1', period: 'month' });

    expect(result.ok).toBe(true);
    const keys = createdRows.map((row) => row.metric_key);
    expect(keys).toContain('vertical.beauty.no_show_rate_pct');
    expect(keys).toContain('vertical.fitness.no_show_rate_pct');
  });

  test('tenant sem dados verticais nao persiste chaves vertical.* e nao emite warning', async () => {
    const { engine, createdRows } = loadEngine({});

    const result = await engine.collectSnapshots({ tenantId: 'tenant-1', period: 'month' });

    expect(result.ok).toBe(true);
    expect(result.warnings).toBeUndefined();
    const keys = createdRows.map((row) => row.metric_key);
    expect(keys.some((key) => key.startsWith('vertical.'))).toBe(false);
  });

  test('falha na coleta vertical nao quebra a coleta das demais metricas', async () => {
    const { engine, createdRows } = loadEngine({
      membershipVerticals: ['beauty'],
      verticalMetricsError: new Error('db indisponivel'),
    });

    const result = await engine.collectSnapshots({ tenantId: 'tenant-1', period: 'month' });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(['vertical_metrics_unavailable']);
    const keys = createdRows.map((row) => row.metric_key);
    expect(keys).toContain('event_ledger.total_events');
    expect(keys.some((key) => key.startsWith('vertical.'))).toBe(false);
  });

  test('secoes nulas sao omitidas sem derrubar as demais', async () => {
    const { engine, createdRows } = loadEngine({
      membershipVerticals: ['beauty'],
      verticalMetrics: {
        beauty: { attendance: null, membership: beautyMetrics.membership, revenue: null },
      },
    });

    const result = await engine.collectSnapshots({ tenantId: 'tenant-1', period: 'month' });

    expect(result.ok).toBe(true);
    const keys = createdRows.map((row) => row.metric_key);
    expect(keys).toContain('vertical.beauty.memberships_active');
    expect(keys).not.toContain('vertical.beauty.no_show_rate_pct');
    expect(keys).not.toContain('vertical.beauty.active_subscriptions');
  });
});

describe('InsightEngine — insights sobre KPIs verticais', () => {
  function loadInsightEngine() {
    jest.resetModules();
    jest.doMock('../../api/db/models', () => ({
      TenantGoal: () => ({ findAll: jest.fn(async () => []) }),
      TenantInsight: () => ({ findOne: jest.fn(async () => null) }),
      TenantInsightEvidence: () => ({ create: jest.fn(async (data) => data) }),
      TenantMetricSnapshot: () => ({ findAll: jest.fn(async () => []) }),
    }));
    // eslint-disable-next-line global-require
    const { InsightEngine } = require('../../api/core/tenant-intelligence/InsightEngine');
    return new InsightEngine();
  }

  test('queda >20% em KPI vertical gera metric_drop com titulo em linguagem de negocio', async () => {
    const engine = loadInsightEngine();
    const now = Date.now();
    const snapshots = [
      { id: 's2', metric_key: 'vertical.beauty.no_show_rate_pct', value: 26, period_end: new Date(now).toISOString() },
      { id: 's1', metric_key: 'vertical.beauty.no_show_rate_pct', value: 20, period_end: new Date(now - 86400000).toISOString() },
    ];

    const result = await engine.generateInsights({
      tenantId: 'tenant-1',
      snapshots,
      persist: false,
      refreshMetrics: false,
    });

    expect(result.ok).toBe(true);
    const insight = result.insights.find((item) => item.relatedMetrics.includes('vertical.beauty.no_show_rate_pct'));
    expect(insight).toBeDefined();
    expect(insight.type).toBe('metric_increase');
    expect(insight.title).toContain('taxa de não comparecimento (no-show) — estética e beleza');
    // Nunca expor a chave crua na superficie humana
    expect(insight.title).not.toContain('vertical.');
    expect(insight.description).not.toContain('vertical.');
  });

  test('snapshot unico nao gera insight de variacao', async () => {
    const engine = loadInsightEngine();
    const result = await engine.generateInsights({
      tenantId: 'tenant-1',
      snapshots: [
        { id: 's1', metric_key: 'vertical.fitness.churn_rate_pct', value: 30, period_end: new Date().toISOString() },
      ],
      persist: false,
      refreshMetrics: false,
    });

    expect(result.ok).toBe(true);
    expect(result.insights).toHaveLength(0);
  });
});

describe('operationalLanguage — labels de chaves verticais', () => {
  // eslint-disable-next-line global-require
  const { metricLabel } = require('../../api/core/tenant-intelligence/operationalLanguage');

  test('traduz sufixo e vertical conhecidos', () => {
    expect(metricLabel('vertical.fitness.no_show_rate_pct')).toBe('taxa de não comparecimento (no-show) — academia/fitness');
    expect(metricLabel('vertical.beauty.churn_rate_pct')).toBe('taxa de cancelamento de assinaturas — estética e beleza');
    expect(metricLabel('vertical.bakery.attendances_total')).toBe('comparecimentos registrados — padaria');
  });

  test('vertical desconhecida cai em fallback humanizado (nunca chave crua)', () => {
    const label = metricLabel('vertical.petShop.return_rate_pct');
    expect(label).toBe('taxa de retorno de clientes — pet shop');
    expect(label).not.toContain('vertical.');
  });
});
