'use strict';

describe('selftestService - pbxEventRuntime', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.SELFTEST_PBX_EVENT_DISPATCH_DEAD_FAIL;
  });

  function setupCommonMocks({ byKindItems, recentPbxEvents = 0 }) {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const getExecutionQueueMetrics = jest.fn().mockResolvedValue({
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
    });
    const getExecutionQueueMetricsByKind = jest.fn().mockResolvedValue({
      ok: true,
      items: byKindItems,
    });
    const sequelizeQuery = jest.fn().mockImplementation(async (sql) => {
      const q = String(sql || '');
      if (q.includes('FROM public_access_tokens')) {
        return [[{ active_total: '0', active_with_revoked_at: '0', active_expired: '0' }]];
      }
      if (q.includes("CallRinging") && q.includes('FROM event_ledger')) {
        return [[{ recent_pbx_events: String(recentPbxEvents) }]];
      }
      return [[{}]];
    });

    jest.doMock('../../api/utils/logger', () => logger);
    jest.doMock('../../api/db/health', () => ({
      checkDbConnection: jest.fn().mockResolvedValue({ ok: true, latencyMs: 5, errorMessage: null }),
      getMigrationStatusSafe: jest.fn().mockResolvedValue({ pendingCount: 0 }),
    }));
    jest.doMock('../../api/services/systemStatusService', () => ({
      checkRedisStatus: jest.fn().mockResolvedValue({ status: 'healthy', details: {}, error: null }),
      checkRagServiceStatus: jest.fn().mockResolvedValue({ status: 'healthy', details: {}, error: null }),
    }));
    jest.doMock('../../api/services/eventLedgerMetricsService', () => ({
      getEventLedgerMetrics: jest.fn().mockResolvedValue({ ok: true, metrics: { total: 10, recent: 3 } }),
    }));
    jest.doMock('../../api/services/flowExecutionLedgerMetricsService', () => ({
      getFlowExecutionLedgerMetrics: jest.fn().mockResolvedValue({ ok: true, metrics: { total: 2, recent: 1, failedTotal: 0 } }),
    }));
    jest.doMock('../../api/services/executionQueueService', () => ({
      getExecutionQueueMetrics,
      getExecutionQueueMetricsByKind,
    }));
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({ query: sequelizeQuery })),
    }));

    return { getExecutionQueueMetricsByKind };
  }

  test('reports pbxEventRuntime as healthy when queue is stable', async () => {
    setupCommonMocks({
      byKindItems: [
        { kind: 'scan_pbx_cdr_events', pending: 0, retryingPending: 0, dead: 0, pendingLagSec: 0 },
        { kind: 'dispatch_event_trigger', pending: 0, retryingPending: 0, dead: 0, pendingLagSec: 0 },
      ],
      recentPbxEvents: 7,
    });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out.status).toBe('PASS');
    expect(out.checks.pbxEventRuntime.status).toBe('healthy');
    expect(out.checks.pbxEventRuntime.details.recentPbxEvents).toBe(7);
  });

  test('fails selftest when pbx dispatch dead exceeds threshold', async () => {
    process.env.SELFTEST_PBX_EVENT_DISPATCH_DEAD_FAIL = '1';
    setupCommonMocks({
      byKindItems: [
        { kind: 'scan_pbx_cdr_events', pending: 0, retryingPending: 0, dead: 0, pendingLagSec: 0 },
        { kind: 'dispatch_event_trigger', pending: 0, retryingPending: 0, dead: 1, pendingLagSec: 0 },
      ],
      recentPbxEvents: 1,
    });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out.status).toBe('FAIL');
    expect(out.checks.pbxEventRuntime.status).toBe('unhealthy');
    expect(out.checks.pbxEventRuntime.error).toBe('pbx_event_runtime_threshold_exceeded');
  });
});

