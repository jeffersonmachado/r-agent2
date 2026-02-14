'use strict';

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(),
}));

const { getSequelize } = require('../../api/db/sequelize');
const { getFlowExecutionLedgerMetrics } = require('../../api/services/flowExecutionLedgerMetricsService');

describe('flowExecutionLedgerMetricsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns db_unavailable when sequelize is missing', async () => {
    getSequelize.mockReturnValue(null);
    const out = await getFlowExecutionLedgerMetrics({ tenantId: 'tenant-a' });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('db_unavailable');
  });

  test('aggregates execution metrics including recentByMode', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([[{
        total: '8',
        recent: '3',
        failed_total: '2',
        failed_recent: '1',
      }]])
      .mockResolvedValueOnce([[
        { mode: 'simulation', recent: '2' },
        { mode: 'message', recent: '1' },
      ]]);
    getSequelize.mockReturnValue({ query });

    const out = await getFlowExecutionLedgerMetrics({ tenantId: 'tenant-a', windowMinutes: 60 });

    expect(out.ok).toBe(true);
    expect(out.metrics).toEqual({
      total: 8,
      recent: 3,
      failedTotal: 2,
      failedRecent: 1,
      recentByMode: {
        simulation: 2,
        message: 1,
      },
      nonSimulationRecent: 1,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
});

