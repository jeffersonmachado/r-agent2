'use strict';

describe('googleAdsAttributionMonitorService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('getOrderAttributionExceptions agrega resumo, fontes e itens recentes', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([[{
        total_missing: 8,
        recent_missing: 3,
        distinct_orders_recent: 2,
        last_occurred_at: '2026-04-19T12:00:00.000Z',
      }]])
      .mockResolvedValueOnce([[{ source: 'orders.storefront', total: 8, recent: 3 }]])
      .mockResolvedValueOnce([[{
        id: 'evt-1',
        occurred_at: '2026-04-19T12:00:00.000Z',
        correlation_id: 'ordcor-1',
        source: 'orders.storefront',
        subject_id: 'ord-1',
        payload: { orderNumber: 'demo-abc123', deliveryType: 'delivery' },
      }]])
      .mockResolvedValueOnce([[{
        current_count: 3,
        previous_count: 1,
        distinct_orders_current: 2,
        last_occurred_at: '2026-04-19T12:00:00.000Z',
      }]]);

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({ query })),
    }));

    const { getOrderAttributionExceptions } = require('../../api/services/marketing/googleAdsAttributionMonitorService');
    const out = await getOrderAttributionExceptions({ tenantId: 'tenant-1', windowDays: 7, limit: 20 });

    expect(out).toEqual(expect.objectContaining({
      ok: true,
      tenantId: 'tenant-1',
      windowDays: 7,
      summary: expect.objectContaining({
        totalMissing: 8,
        recentMissing: 3,
        distinctOrdersRecent: 2,
        lastOccurredAt: '2026-04-19T12:00:00.000Z',
      }),
      alert: expect.objectContaining({
        triggered: true,
        severity: 'warning',
        currentCount: 3,
        previousCount: 1,
      }),
      bySource: [{ source: 'orders.storefront', total: 8, recent: 3 }],
    }));
    expect(out.items[0]).toEqual(expect.objectContaining({
      id: 'evt-1',
      correlationId: 'ordcor-1',
      source: 'orders.storefront',
      orderId: 'ord-1',
      payload: expect.objectContaining({ orderNumber: 'demo-abc123' }),
    }));
    expect(query).toHaveBeenCalledTimes(4);
  });

  test('getOrderAttributionExceptions retorna db_unavailable sem sequelize', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => null),
    }));

    const { getOrderAttributionExceptions } = require('../../api/services/marketing/googleAdsAttributionMonitorService');
    await expect(getOrderAttributionExceptions({ tenantId: 'tenant-1' })).resolves.toEqual({
      ok: false,
      error: 'db_unavailable',
    });
  });

  test('getOrderAttributionGrowthStatus calcula trigger por crescimento anormal', async () => {
    const query = jest.fn().mockResolvedValueOnce([[{
      current_count: 6,
      previous_count: 2,
      distinct_orders_current: 4,
      last_occurred_at: '2026-04-19T12:00:00.000Z',
    }]]);

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({ query })),
    }));

    const { getOrderAttributionGrowthStatus } = require('../../api/services/marketing/googleAdsAttributionMonitorService');
    const out = await getOrderAttributionGrowthStatus({ tenantId: 'tenant-1', windowDays: 1, minRecentMissing: 3, growthFactorThreshold: 2 });

    expect(out).toEqual(expect.objectContaining({
      ok: true,
      tenantId: 'tenant-1',
      currentCount: 6,
      previousCount: 2,
      distinctOrdersCurrent: 4,
      growthFactor: 3,
      severity: 'warning',
      triggered: true,
    }));
  });
});
