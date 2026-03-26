'use strict';

const mockGetSequelize = jest.fn(() => ({}));
const mockFindAll = jest.fn();

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: (...args) => mockGetSequelize(...args),
}));

jest.mock('../../api/db/models', () => ({
  BillingTransaction: () => ({
    findAll: (...args) => mockFindAll(...args),
  }),
}));

const { getBillingOpsMetrics } = require('../../api/services/billingOpsMetricsService');

describe('billingOpsMetricsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({});
  });

  test('aggregates confirmed, refunded, chargeback and net amount', async () => {
    mockFindAll.mockResolvedValueOnce([
      { status: 'confirmed', amount: '100.00', provider: 'asaas', vertical: 'fitness', toJSON() { return this; } },
      { status: 'refunded', amount: '20.00', provider: 'asaas', vertical: 'fitness', toJSON() { return this; } },
      { status: 'chargeback', amount: '10.00', provider: 'mercado_pago', vertical: 'beauty', toJSON() { return this; } },
      { status: 'overdue', amount: '80.00', provider: 'mercado_pago', vertical: 'beauty', toJSON() { return this; } },
      { status: 'pending', amount: '50.00', provider: 'asaas', vertical: 'beauty', toJSON() { return this; } },
    ]);

    const out = await getBillingOpsMetrics({ tenantId: 'tenant-1', windowDays: 15 });

    expect(out.ok).toBe(true);
    expect(out.metrics.totalTransactions).toBe(5);
    expect(out.metrics.confirmedCount).toBe(1);
    expect(out.metrics.refundedCount).toBe(1);
    expect(out.metrics.chargebackCount).toBe(1);
    expect(out.metrics.overdueCount).toBe(1);
    expect(out.metrics.pendingCount).toBe(1);
    expect(out.metrics.grossConfirmedAmount).toBe(100);
    expect(out.metrics.refundedAmount).toBe(20);
    expect(out.metrics.chargebackAmount).toBe(10);
    expect(out.metrics.netRecoveredAmount).toBe(70);
    expect(out.metrics.byProvider.asaas.refunded).toBe(1);
    expect(out.metrics.byVertical.beauty.chargeback).toBe(1);
  });

  test('returns db_unavailable when sequelize is absent', async () => {
    mockGetSequelize.mockReturnValueOnce(null);
    const out = await getBillingOpsMetrics({ tenantId: 'tenant-1' });
    expect(out).toEqual({ ok: false, error: 'db_unavailable' });
  });
});
