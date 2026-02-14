'use strict';

describe('selftestService - flowExecutionLedger', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.SELFTEST_FLOW_EXECUTION_LEDGER_REQUIRE_RUNTIME_RECENT;
  });

  function setupCommonMocks({ flowMetrics }) {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const sequelizeQuery = jest.fn().mockImplementation(async (sql) => {
      const q = String(sql || '');
      if (q.includes('FROM public_access_tokens')) {
        return [[{ active_total: '0', active_with_revoked_at: '0', active_expired: '0' }]];
      }
      if (q.includes('recent_voice_events')) {
        return [[{ recent_voice_events: '0', recent_voice_ended: '0' }]];
      }
      if (q.includes('minutes_since_last')) {
        return [[{ minutes_since_last: null }]];
      }
      if (q.includes('recent_pbx_events')) {
        return [[{ recent_pbx_events: '0' }]];
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
          total: 1,
          recent: 1,
          dispatch: {
            summary: {
              pending: 0,
              retryingPending: 0,
              processing: 0,
              done: 1,
              doneRecent: 1,
              dead: 0,
              deadRecent: 0,
              flowTriggerFailuresRecent: 0,
            },
            byTarget: [],
            byTenant: [],
          },
        },
      }),
    }));
    jest.doMock('../../api/services/flowExecutionLedgerMetricsService', () => ({
      getFlowExecutionLedgerMetrics: jest.fn().mockResolvedValue({
        ok: true,
        metrics: flowMetrics,
      }),
    }));
    jest.doMock('../../api/services/voiceRuntimeService', () => ({
      getVoiceRuntimeStats: jest.fn(() => ({ totalSessions: 0 })),
    }));
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({ query: sequelizeQuery })),
    }));
  }

  test('keeps flowExecutionLedger healthy when runtime modes are present', async () => {
    setupCommonMocks({
      flowMetrics: {
        total: 4,
        recent: 2,
        failedTotal: 0,
        failedRecent: 0,
        recentByMode: { simulation: 1, message: 1 },
        nonSimulationRecent: 1,
      },
    });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out.checks.flowExecutionLedger.status).toBe('healthy');
    expect(out.checks.flowExecutionLedger.error).toBeNull();
  });

  test('degrades when only simulation executions are recent', async () => {
    setupCommonMocks({
      flowMetrics: {
        total: 4,
        recent: 2,
        failedTotal: 0,
        failedRecent: 0,
        recentByMode: { simulation: 2 },
        nonSimulationRecent: 0,
      },
    });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out.checks.flowExecutionLedger.status).toBe('degraded');
    expect(out.checks.flowExecutionLedger.error).toBe('flow_execution_ledger_no_runtime_recent');
    expect(out.status).toBe('WARN');
  });
});

