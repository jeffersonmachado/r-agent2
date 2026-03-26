'use strict';

jest.mock('../../api/services/billingOpsMetricsService', () => ({
  getBillingOpsMetrics: jest.fn(),
}));

jest.mock('../../api/services/executionQueueService', () => ({
  getExecutionQueueMetricsByKind: jest.fn(),
}));

const { getBillingOpsMetrics } = require('../../api/services/billingOpsMetricsService');
const { getExecutionQueueMetricsByKind } = require('../../api/services/executionQueueService');
const { getBillingSloHealth } = require('../../api/services/billingSloHealthService');

describe('billingSloHealthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns healthy when all indicators are within SLO', async () => {
    getBillingOpsMetrics.mockResolvedValueOnce({
      ok: true,
      metrics: {
        totalTransactions: 100,
        pendingCount: 4,
        overdueCount: 3,
        refundedCount: 2,
        chargebackCount: 1,
        cancelledCount: 0,
      },
    });
    getExecutionQueueMetricsByKind.mockResolvedValueOnce({
      ok: true,
      items: [{ kind: 'billing_reconciliation', dead: 0, pendingLagSec: 120, pending: 1, processing: 0, retryingPending: 0 }],
    });

    const out = await getBillingSloHealth({ tenantId: 'tenant-a', windowDays: 30 });

    expect(out.ok).toBe(true);
    expect(out.status).toBe('healthy');
    expect(out.violations).toHaveLength(0);
    expect(out.indicators.problematicRatePct).toBe(10);
  });

  test('returns degraded/unhealthy based on number of violations', async () => {
    getBillingOpsMetrics.mockResolvedValueOnce({
      ok: true,
      metrics: {
        totalTransactions: 100,
        pendingCount: 20,
        overdueCount: 10,
        refundedCount: 10,
        chargebackCount: 3,
        cancelledCount: 0,
      },
    });
    getExecutionQueueMetricsByKind.mockResolvedValueOnce({
      ok: true,
      items: [{ kind: 'billing_reconciliation', dead: 2, pendingLagSec: 3600, pending: 8, processing: 1, retryingPending: 2 }],
    });

    const out = await getBillingSloHealth({ tenantId: 'tenant-a' });

    expect(out.ok).toBe(true);
    expect(out.status).toBe('unhealthy');
    expect(out.violations.length).toBeGreaterThan(2);
    expect(out.violations.map((v) => v.key)).toEqual(expect.arrayContaining(['deadJobs', 'pendingLagSec', 'chargebackRatePct']));
  });

  test('returns upstream errors when dependencies are unavailable', async () => {
    getBillingOpsMetrics.mockResolvedValueOnce({ ok: false, error: 'db_unavailable' });
    getExecutionQueueMetricsByKind.mockResolvedValueOnce({ ok: true, items: [] });

    const out = await getBillingSloHealth({ tenantId: 'tenant-a' });

    expect(out).toEqual({ ok: false, error: 'db_unavailable' });
  });
});
