'use strict';

describe('selftestService - eventDispatchRuntime', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.SELFTEST_EVENT_DISPATCH_DEAD_RECENT_FAIL;
  });

  function setupCommonMocks({ dispatchSummary }) {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    jest.doMock('../../api/utils/logger', () => logger);
    jest.doMock('../../api/db/health', () => ({
      checkDbConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 5, errorMessage: null }),
      getMigrationStatusSafe: jest.fn().mockResolvedValue({ pendingCount: 0 }),
    }));
    jest.doMock('../../api/services/systemStatusService', () => ({
      checkRedisStatus: jest.fn().mockResolvedValue({ status: 'healthy', details: {}, error: null }),
      checkRagServiceStatus: jest.fn().mockResolvedValue({ status: 'healthy', details: {}, error: null }),
    }));
    jest.doMock('../../api/services/executionQueueService', () => ({
      getExecutionQueueMetrics: jest.fn().mockResolvedValue({
        ok: true,
        metrics: {
          pending: 0,
          retryingPending: 0,
          processing: 0,
          done: 1,
          dead: 0,
          pendingLagSec: 0,
          oldestPendingNextAttemptAt: null,
        },
      }),
      getExecutionQueueMetricsByKind: jest.fn().mockResolvedValue({
        ok: true,
        items: [
          { kind: 'scan_pbx_cdr_events', pending: 0, retryingPending: 0, dead: 0, pendingLagSec: 0 },
          { kind: 'dispatch_event_trigger', pending: 0, retryingPending: 0, dead: 0, pendingLagSec: 0 },
        ],
      }),
    }));
    jest.doMock('../../api/services/eventLedgerMetricsService', () => ({
      getEventLedgerMetrics: jest.fn().mockResolvedValue({
        ok: true,
        windowMinutes: 60,
        metrics: {
          total: 10,
          recent: 4,
          dispatch: {
            summary: dispatchSummary,
            byTarget: [
              {
                target: 'combined',
                pending: Number(dispatchSummary.pending || 0),
                retryingPending: Number(dispatchSummary.retryingPending || 0),
                processing: Number(dispatchSummary.processing || 0),
                done: Number(dispatchSummary.done || 0),
                doneRecent: Number(dispatchSummary.doneRecent || 0),
                dead: Number(dispatchSummary.dead || 0),
                deadRecent: Number(dispatchSummary.deadRecent || 0),
                flowTriggerFailuresRecent: Number(dispatchSummary.flowTriggerFailuresRecent || 0),
                pendingLagSec: Number(dispatchSummary.pendingLagSec || 0),
              },
            ],
          },
        },
      }),
    }));
    jest.doMock('../../api/services/flowExecutionLedgerMetricsService', () => ({
      getFlowExecutionLedgerMetrics: jest.fn().mockResolvedValue({
        ok: true,
        metrics: { total: 2, recent: 1, failedTotal: 0 },
      }),
    }));
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({
        query: jest.fn().mockResolvedValue([[{ active_total: '0', active_with_revoked_at: '0', active_expired: '0' }]]),
      })),
    }));
  }

  test('reports eventDispatchRuntime as healthy when dispatch queue is stable', async () => {
    setupCommonMocks({
      dispatchSummary: {
        pending: 0,
        retryingPending: 0,
        processing: 0,
        done: 5,
        doneRecent: 5,
        dead: 0,
        deadRecent: 0,
        flowTriggerFailuresRecent: 0,
        pendingLagSec: 0,
      },
    });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out.checks.eventDispatchRuntime.status).toBe('healthy');
    expect(out.status).toBe('PASS');
  });

  test('fails selftest when dispatch deadRecent exceeds threshold', async () => {
    process.env.SELFTEST_EVENT_DISPATCH_DEAD_RECENT_FAIL = '1';
    setupCommonMocks({
      dispatchSummary: {
        pending: 0,
        retryingPending: 0,
        processing: 0,
        done: 1,
        doneRecent: 1,
        dead: 0,
        deadRecent: 1,
        flowTriggerFailuresRecent: 0,
        pendingLagSec: 0,
      },
    });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out.checks.eventDispatchRuntime.status).toBe('unhealthy');
    expect(out.checks.eventDispatchRuntime.error).toBe('event_dispatch_runtime_threshold_exceeded');
    expect(out.status).toBe('FAIL');
  });
});

