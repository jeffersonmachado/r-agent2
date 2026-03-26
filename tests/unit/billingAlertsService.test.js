'use strict';

const mockFindAll = jest.fn();

jest.mock('../../api/services/billingSloHealthService', () => ({
  getBillingSloHealth: jest.fn(),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({})),
}));

jest.mock('../../api/db/models', () => ({
  EventLedger: () => ({
    findAll: (...args) => mockFindAll(...args),
  }),
}));

const { getBillingSloHealth } = require('../../api/services/billingSloHealthService');
const { appendEventV1 } = require('../../api/services/eventLedgerService');
const { evaluateBillingAlerts } = require('../../api/services/billingAlertsService');

describe('billingAlertsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindAll.mockResolvedValue([]);
  });

  test('creates mapped alerts and persists unique alert records', async () => {
    getBillingSloHealth.mockResolvedValueOnce({
      ok: true,
      status: 'unhealthy',
      targets: {},
      indicators: {},
      violations: [
        { key: 'deadJobs', actual: 2, target: 0 },
        { key: 'pendingLagSec', actual: 4000, target: 1800 },
        { key: 'chargebackRatePct', actual: 4.2, target: 2 },
      ],
    });

    const out = await evaluateBillingAlerts({ tenantId: 'tenant-a', persist: true });

    expect(out.ok).toBe(true);
    expect(out.alerts.map((a) => a.code)).toEqual(expect.arrayContaining([
      'billing_reconciliation_recurring_failure',
      'billing_reconciliation_backlog_aged',
      'billing_chargeback_spike',
    ]));
    expect(appendEventV1).toHaveBeenCalled();
  });

  test('returns upstream error when slo health is unavailable', async () => {
    getBillingSloHealth.mockResolvedValueOnce({ ok: false, error: 'db_unavailable' });

    const out = await evaluateBillingAlerts({ tenantId: 'tenant-a' });

    expect(out).toEqual({ ok: false, error: 'db_unavailable' });
    expect(appendEventV1).not.toHaveBeenCalled();
  });
});
