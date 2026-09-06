'use strict';

/**
 * MetricEngine — snapshots de metricas operacionais de negocio (operations.*).
 * DB e servicos mockados (sem Postgres/Redis).
 */

function loadEngine({ generalMetrics, generalMetricsError = null } = {}) {
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
    getGeneralMetrics: jest.fn(async () => {
      if (generalMetricsError) throw generalMetricsError;
      return generalMetrics;
    }),
  }));

  // eslint-disable-next-line global-require
  const { MetricEngine } = require('../../api/core/tenant-intelligence/MetricEngine');
  return { engine: new MetricEngine(), createdRows };
}

const fullGeneralMetrics = {
  totalTickets: 42,
  openTickets: 7,
  closedTickets: 35,
  inProgressTickets: 3,
  waitingTickets: 4,
  avgResolutionTime: 120,
  avgFirstResponseTime: 5,
  avgFirstResponseTimeSeconds: 300,
  avgHandlingTimeSeconds: 7200,
  abandonmentRate: 0.1234,
  botContainmentRate: 0.7567,
  totalMessages: 500,
  ticketsByStatus: { waiting: 4, in_progress: 3, closed: 35 },
};

describe('MetricEngine.collectSnapshots — metricas operacionais', () => {
  test('persiste chaves operations.* com source operations', async () => {
    const { engine, createdRows } = loadEngine({ generalMetrics: fullGeneralMetrics });

    const result = await engine.collectSnapshots({ tenantId: 'tenant-1', period: 'month' });

    expect(result.ok).toBe(true);
    expect(result.warnings).toBeUndefined();
    // Hook event-driven: coleta avalia recomendacoes aplicadas (nenhuma aqui)
    expect(result.outcomeEvaluation).toMatchObject({ ok: true, total: 0, evaluated: 0, pending: 0 });

    const byKey = Object.fromEntries(createdRows.map((row) => [row.metric_key, row]));
    expect(byKey['operations.tickets_total'].value).toBe(42);
    expect(byKey['operations.tickets_total'].source).toBe('operations');
    expect(byKey['operations.tickets_open'].value).toBe(7);
    expect(byKey['operations.avg_first_response_minutes'].value).toBe(5);
    expect(byKey['operations.avg_resolution_minutes'].value).toBe(120);
    // Fracoes 0..1 convertidas para percentual com 2 casas
    expect(byKey['operations.abandonment_rate_pct'].value).toBe(12.34);
    expect(byKey['operations.bot_containment_rate_pct'].value).toBe(75.67);

    // Metricas do event ledger mantem source event_ledger
    expect(byKey['event_ledger.total_events'].value).toBe(10);
    expect(byKey['event_ledger.total_events'].source).toBe('event_ledger');
  });

  test('omite bot_containment quando taxa eh null', async () => {
    const { engine, createdRows } = loadEngine({
      generalMetrics: { ...fullGeneralMetrics, botContainmentRate: null },
    });

    const result = await engine.collectSnapshots({ tenantId: 'tenant-1', period: 'month' });

    expect(result.ok).toBe(true);
    const keys = createdRows.map((row) => row.metric_key);
    expect(keys).not.toContain('operations.bot_containment_rate_pct');
    expect(keys).toContain('operations.abandonment_rate_pct');
  });

  test('falha nas metricas operacionais nao quebra a coleta do event ledger', async () => {
    const { engine, createdRows } = loadEngine({
      generalMetricsError: new Error('db indisponivel'),
    });

    const result = await engine.collectSnapshots({ tenantId: 'tenant-1', period: 'month' });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(['operational_metrics_unavailable']);
    expect(result.outcomeEvaluation).toMatchObject({ ok: true, total: 0 });
    const keys = createdRows.map((row) => row.metric_key);
    expect(keys).toContain('event_ledger.total_events');
    expect(keys.some((key) => key.startsWith('operations.'))).toBe(false);
  });
});
