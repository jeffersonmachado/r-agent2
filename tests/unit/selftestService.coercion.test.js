'use strict';

describe('selftestService - coercion guards', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function hostileError() {
    const err = {};
    Object.defineProperty(err, 'message', {
      get() {
        throw new Error('hostile message getter');
      },
    });
    err.toString = () => {
      throw new Error('hostile toString');
    };
    return err;
  }

  function setupBaseMocks({ dbError = null, eventDispatchError = null, redisError = null } = {}) {
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
      if (q.includes('flow_trigger_failures_recent')) {
        return [[{ flow_trigger_failures_recent: '0' }]];
      }
      return [[{}]];
    });

    jest.doMock('../../api/utils/logger', () => logger);
    jest.doMock('../../api/db/health', () => ({
      checkDbConnection: dbError
        ? jest.fn().mockRejectedValue(dbError)
        : jest.fn().mockResolvedValue({ ok: true, latencyMs: 5, errorMessage: null }),
      getMigrationStatusSafe: jest.fn().mockResolvedValue({ pendingCount: 0 }),
    }));
    jest.doMock('../../api/services/systemStatusService', () => ({
      checkRedisStatus: redisError
        ? jest.fn().mockRejectedValue(redisError)
        : jest.fn().mockResolvedValue({ status: 'healthy', details: {}, error: null }),
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
      getEventLedgerMetrics: eventDispatchError
        ? jest.fn().mockRejectedValue(eventDispatchError)
        : jest.fn().mockResolvedValue({
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
                  pendingLagSec: 0,
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
        metrics: { total: 1, recent: 1, failedRecent: 0, nonSimulationRecent: 1 },
      }),
    }));
    jest.doMock('../../api/services/voiceRuntimeService', () => ({
      getVoiceRuntimeStats: jest.fn(() => ({ totalSessions: 0 })),
    }));
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({ query: sequelizeQuery })),
    }));
  }

  test('runSelftest tolerates hostile db error.message getter', async () => {
    setupBaseMocks({ dbError: hostileError() });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out).toBeTruthy();
    expect(out.checks.db.status).toBe('unhealthy');
    expect(typeof out.checks.db.error).toBe('string');
  });

  test('runSelftest tolerates hostile event dispatch error.message getter', async () => {
    setupBaseMocks({ eventDispatchError: hostileError() });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out).toBeTruthy();
    expect(out.checks.eventDispatchRuntime.status).toBe('degraded');
    expect(typeof out.checks.eventDispatchRuntime.error).toBe('string');
  });

  test('runSelftest tolerates hostile redis error.message getter', async () => {
    setupBaseMocks({ redisError: hostileError() });

    const { runSelftest } = require('../../api/services/selftestService');
    const out = await runSelftest();

    expect(out).toBeTruthy();
    expect(out.checks.redis.status).toBe('unhealthy');
    expect(typeof out.checks.redis.error).toBe('string');
  });
});
