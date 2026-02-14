'use strict';

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(),
}));

const { getSequelize } = require('../../api/db/sequelize');
const { getEventLedgerMetrics } = require('../../api/services/eventLedgerMetricsService');

describe('eventLedgerMetricsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns db_unavailable when sequelize is missing', async () => {
    getSequelize.mockReturnValue(null);
    const out = await getEventLedgerMetrics({ tenantId: 't1' });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('db_unavailable');
  });

  test('returns invalid_window_minutes for invalid window', async () => {
    getSequelize.mockReturnValue({ query: jest.fn() });
    const out = await getEventLedgerMetrics({ tenantId: 't1', windowMinutes: 0 });
    expect(out.ok).toBe(false);
    expect(out.error).toBe('invalid_window_minutes');
  });

  test('aggregates event ledger + dispatch metrics by target', async () => {
    const now = Date.now();
    const oldestPending = new Date(now - 12_000).toISOString();
    const query = jest.fn()
      .mockResolvedValueOnce([[{ total: '25', recent: '7' }]])
      .mockResolvedValueOnce([[
        {
          dispatch_target: 'webhooks',
          pending: '2',
          retrying_pending: '1',
          processing: '0',
          done: '11',
          dead: '3',
          done_recent: '4',
          dead_recent: '1',
          flow_trigger_failures_total: '2',
          flow_trigger_failures_recent: '1',
          oldest_pending_next_attempt_at: oldestPending,
        },
        {
          dispatch_target: 'flows',
          pending: '1',
          retrying_pending: '1',
          processing: '2',
          done: '5',
          dead: '0',
          done_recent: '3',
          dead_recent: '0',
          flow_trigger_failures_total: '1',
          flow_trigger_failures_recent: '1',
          oldest_pending_next_attempt_at: null,
        },
      ]])
      .mockResolvedValueOnce([[
        {
          tenant_key: 'tenant-a',
          pending: '3',
          retrying_pending: '2',
          processing: '2',
          done: '16',
          dead: '3',
          done_recent: '7',
          dead_recent: '1',
          flow_trigger_failures_total: '3',
          flow_trigger_failures_recent: '2',
          oldest_pending_next_attempt_at: oldestPending,
        },
      ]]);
    getSequelize.mockReturnValue({ query });

    const out = await getEventLedgerMetrics({ tenantId: 'tenant-a', windowMinutes: 60 });

    expect(out.ok).toBe(true);
    expect(out.metrics.total).toBe(25);
    expect(out.metrics.recent).toBe(7);
    expect(out.metrics.dispatch.summary).toEqual({
      pending: 3,
      retryingPending: 2,
      processing: 2,
      done: 16,
      dead: 3,
      doneRecent: 7,
      deadRecent: 1,
      flowTriggerFailuresTotal: 3,
      flowTriggerFailuresRecent: 2,
    });
    expect(out.metrics.dispatch.byTarget).toHaveLength(2);
    expect(out.metrics.dispatch.byTarget[0]).toMatchObject({
      target: 'webhooks',
      pending: 2,
      retryingPending: 1,
      processing: 0,
      done: 11,
      dead: 3,
      doneRecent: 4,
      deadRecent: 1,
      flowTriggerFailuresTotal: 2,
      flowTriggerFailuresRecent: 1,
    });
    expect(out.metrics.dispatch.byTarget[0].oldestPendingNextAttemptAt).toBe(new Date(oldestPending).toISOString());
    expect(out.metrics.dispatch.byTarget[0].pendingLagSec).toBeGreaterThanOrEqual(0);
    expect(out.metrics.dispatch.byTarget[1]).toMatchObject({
      target: 'flows',
      pending: 1,
      retryingPending: 1,
      processing: 2,
      done: 5,
      dead: 0,
      doneRecent: 3,
      deadRecent: 0,
      flowTriggerFailuresTotal: 1,
      flowTriggerFailuresRecent: 1,
      oldestPendingNextAttemptAt: null,
      pendingLagSec: 0,
    });
    expect(out.metrics.dispatch.byTenant).toHaveLength(1);
    expect(out.metrics.dispatch.byTenant[0]).toMatchObject({
      tenantKey: 'tenant-a',
      pending: 3,
      retryingPending: 2,
      processing: 2,
      done: 16,
      dead: 3,
      doneRecent: 7,
      deadRecent: 1,
      flowTriggerFailuresTotal: 3,
      flowTriggerFailuresRecent: 2,
    });
    expect(query).toHaveBeenCalledTimes(3);
  });
});
