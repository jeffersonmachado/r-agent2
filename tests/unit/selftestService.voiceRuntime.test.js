'use strict';

describe('selftestService - voiceRuntime', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.SELFTEST_VOICE_RUNTIME_ACTIVE_SESSIONS_FAIL;
    delete process.env.SELFTEST_VOICE_RUNTIME_INGEST_SILENCE_FAIL_MIN;
  });

  function setupCommonMocks({
    activeSessions = 0,
    minutesSinceLastVoiceEvent = 10,
    recentVoiceEvents = 3,
    recentVoiceEnded = 1,
  }) {
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
            summary: {
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
            byTarget: [],
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
    jest.doMock('../../api/services/voiceRuntimeService', () => ({
      getVoiceRuntimeStats: jest.fn(() => ({
        ok: true,
        totalSessions: activeSessions,
        items: [],
      })),
    }));
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({
        query: jest.fn().mockImplementation(async (sql) => {
          const q = String(sql || '');
          if (q.includes('FROM public_access_tokens')) {
            return [[{ active_total: '0', active_with_revoked_at: '0', active_expired: '0' }]];
          }
          if (q.includes('recent_voice_events') && q.includes('FROM event_ledger')) {
            return [[{ recent_voice_events: String(recentVoiceEvents), recent_voice_ended: String(recentVoiceEnded) }]];
          }
          if (q.includes('minutes_since_last')) {
            return [[{ minutes_since_last: minutesSinceLastVoiceEvent }]];
          }
          if (q.includes('recent_pbx_events') && q.includes('FROM event_ledger')) {
            return [[{ recent_pbx_events: '0' }]];
          }
          if (q.includes('flow_trigger_failures_recent') && q.includes('FROM execution_jobs')) {
            return [[{ flow_trigger_failures_recent: '0' }]];
          }
          return [[{}]];
        }),
      })),
    }));
  }

  test('reports voiceRuntime as healthy when sessions and ingestion are stable', async () => {
    setupCommonMocks({
      activeSessions: 2,
      minutesSinceLastVoiceEvent: 5,
      recentVoiceEvents: 9,
      recentVoiceEnded: 4,
    });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out.status).toBe('PASS');
    expect(out.checks.voiceRuntime.status).toBe('healthy');
    expect(out.checks.voiceRuntime.details.activeSessions).toBe(2);
    expect(out.checks.voiceRuntime.details.recentVoiceEvents).toBe(9);
  });

  test('fails selftest when voice active sessions exceed threshold', async () => {
    process.env.SELFTEST_VOICE_RUNTIME_ACTIVE_SESSIONS_FAIL = '1';
    setupCommonMocks({
      activeSessions: 1,
      minutesSinceLastVoiceEvent: 1,
      recentVoiceEvents: 2,
      recentVoiceEnded: 1,
    });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out.status).toBe('FAIL');
    expect(out.checks.voiceRuntime.status).toBe('unhealthy');
    expect(out.checks.voiceRuntime.error).toBe('voice_runtime_threshold_exceeded');
  });
});
