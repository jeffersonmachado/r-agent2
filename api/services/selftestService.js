/**
 * Self-tests read-only (auto tester runtime).
 *
 * Objetivo:
 * - checks rápidos, sem efeitos colaterais
 * - timeout curto e retorno estruturado
 *
 * Observação: não deve vazar dados sensíveis.
 */

const logger = require('../utils/logger');

async function safeCheckDb() {
  try {
    const dbHealth = require('../db/health');
    const connectionCheck = await dbHealth.checkDbConnection();
    const migrationStatus = await dbHealth.getMigrationStatusSafe();
    return {
      status: connectionCheck.ok && migrationStatus.pendingCount === 0 ? 'healthy' : 'unhealthy',
      details: {
        latencyMs: connectionCheck.latencyMs,
        migrationsPending: migrationStatus.pendingCount,
      },
      error: connectionCheck.ok ? null : connectionCheck.errorMessage,
    };
  } catch (err) {
    return { status: 'unhealthy', error: err.message || 'db_check_failed' };
  }
}

async function safeCheckPublicTokens() {
  try {
    const { getSequelize } = require('../db/sequelize');
    const sequelize = getSequelize();
    if (!sequelize) {
      return { status: 'degraded', error: 'db_not_initialized' };
    }

    // Não expõe tokens. Apenas contagens.
    const [rows] = await sequelize.query(
      `SELECT
         COUNT(*) FILTER (WHERE active = true) AS active_total,
         COUNT(*) FILTER (WHERE active = true AND revoked_at IS NOT NULL) AS active_with_revoked_at,
         COUNT(*) FILTER (WHERE active = true AND expires_at IS NOT NULL AND expires_at <= NOW()) AS active_expired
       FROM public_access_tokens`
    );

    const r = Array.isArray(rows) && rows[0] ? rows[0] : {};
    const activeTotal = Number(r.active_total || 0);
    const activeExpired = Number(r.active_expired || 0);
    const activeWithRevokedAt = Number(r.active_with_revoked_at || 0);

    // Se houver inconsistências (active=true mas expirado/revogado), reporta degradação.
    const inconsistent = activeExpired > 0 || activeWithRevokedAt > 0;
    return {
      status: inconsistent ? 'degraded' : 'healthy',
      details: {
        activeTotal,
        activeExpired,
        activeWithRevokedAt,
      },
      error: inconsistent ? 'public_tokens_inconsistent_state' : null,
    };
  } catch (err) {
    // Best-effort: não bloqueia selftest inteiro por falha em tabela opcional
    return { status: 'degraded', error: err.message || 'public_tokens_check_failed' };
  }
}

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

function safeThreshold(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function eventDispatchBaseThresholds() {
  return {
    deadWarn: intEnv('SELFTEST_EVENT_DISPATCH_DEAD_WARN', 1),
    deadFail: intEnv('SELFTEST_EVENT_DISPATCH_DEAD_FAIL', 20),
    deadRecentWarn: intEnv('SELFTEST_EVENT_DISPATCH_DEAD_RECENT_WARN', 1),
    deadRecentFail: intEnv('SELFTEST_EVENT_DISPATCH_DEAD_RECENT_FAIL', 10),
    retryWarn: intEnv('SELFTEST_EVENT_DISPATCH_RETRYING_WARN', 20),
    retryFail: intEnv('SELFTEST_EVENT_DISPATCH_RETRYING_FAIL', 200),
    lagWarn: intEnv('SELFTEST_EVENT_DISPATCH_LAG_WARN_SEC', 300),
    lagFail: intEnv('SELFTEST_EVENT_DISPATCH_LAG_FAIL_SEC', 1800),
    flowTriggerFailWarn: intEnv('SELFTEST_EVENT_DISPATCH_FLOW_TRIGGER_FAIL_WARN', 5),
    flowTriggerFailFail: intEnv('SELFTEST_EVENT_DISPATCH_FLOW_TRIGGER_FAIL_FAIL', 50),
  };
}

function parseEventDispatchTenantThresholdOverrides() {
  const raw = process.env.SELFTEST_EVENT_DISPATCH_THRESHOLDS_BY_TENANT_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err) {
    logger.warn('[Selftest] SELFTEST_EVENT_DISPATCH_THRESHOLDS_BY_TENANT_JSON invalido, ignorando', {
      error: err.message,
    });
    return {};
  }
}

function eventDispatchThresholdsForTenant(base, overrides, tenantKey) {
  const tenantCfg = overrides && typeof overrides === 'object' ? overrides[String(tenantKey || '')] : null;
  if (!tenantCfg || typeof tenantCfg !== 'object' || Array.isArray(tenantCfg)) return base;
  return {
    deadWarn: safeThreshold(tenantCfg.deadWarn, base.deadWarn),
    deadFail: safeThreshold(tenantCfg.deadFail, base.deadFail),
    deadRecentWarn: safeThreshold(tenantCfg.deadRecentWarn, base.deadRecentWarn),
    deadRecentFail: safeThreshold(tenantCfg.deadRecentFail, base.deadRecentFail),
    retryWarn: safeThreshold(tenantCfg.retryWarn, base.retryWarn),
    retryFail: safeThreshold(tenantCfg.retryFail, base.retryFail),
    lagWarn: safeThreshold(tenantCfg.lagWarn, base.lagWarn),
    lagFail: safeThreshold(tenantCfg.lagFail, base.lagFail),
    flowTriggerFailWarn: safeThreshold(tenantCfg.flowTriggerFailWarn, base.flowTriggerFailWarn),
    flowTriggerFailFail: safeThreshold(tenantCfg.flowTriggerFailFail, base.flowTriggerFailFail),
  };
}

function eventDispatchItemStatus(item, thresholds) {
  const dead = Number(item?.dead || 0);
  const deadRecent = Number(item?.deadRecent || 0);
  const retryingPending = Number(item?.retryingPending || 0);
  const lagSec = Number(item?.pendingLagSec || 0);
  const flowTriggerFailuresRecent = Number(item?.flowTriggerFailuresRecent || 0);

  const fail =
    dead >= thresholds.deadFail ||
    deadRecent >= thresholds.deadRecentFail ||
    retryingPending >= thresholds.retryFail ||
    lagSec >= thresholds.lagFail ||
    flowTriggerFailuresRecent >= thresholds.flowTriggerFailFail;
  const warn =
    dead >= thresholds.deadWarn ||
    deadRecent >= thresholds.deadRecentWarn ||
    retryingPending >= thresholds.retryWarn ||
    lagSec >= thresholds.lagWarn ||
    flowTriggerFailuresRecent >= thresholds.flowTriggerFailWarn;
  return {
    fail,
    warn,
    dead,
    deadRecent,
    retryingPending,
    lagSec,
    flowTriggerFailuresRecent,
  };
}

async function safeCheckExecutionQueue() {
  try {
    const { getExecutionQueueMetrics } = require('./executionQueueService');
    const result = await getExecutionQueueMetrics({ tenantId: null });
    if (!result.ok) {
      return { status: 'degraded', error: result.error || 'exec_queue_metrics_unavailable' };
    }

    const m = result.metrics || {};
    const dead = Number(m.dead || 0);
    const pending = Number(m.pending || 0);
    const retryingPending = Number(m.retryingPending || 0);
    const lagSec = Number(m.pendingLagSec || 0);

    // Thresholds (WARN/FAIL)
    const deadWarn = intEnv('SELFTEST_EXEC_QUEUE_DEAD_WARN', 1);
    const deadFail = intEnv('SELFTEST_EXEC_QUEUE_DEAD_FAIL', 50);
    const lagWarn = intEnv('SELFTEST_EXEC_QUEUE_PENDING_LAG_WARN_SEC', 30);
    const lagFail = intEnv('SELFTEST_EXEC_QUEUE_PENDING_LAG_FAIL_SEC', 300);
    const pendingWarn = intEnv('SELFTEST_EXEC_QUEUE_PENDING_WARN', 500);
    const pendingFail = intEnv('SELFTEST_EXEC_QUEUE_PENDING_FAIL', 5000);
    const retryWarn = intEnv('SELFTEST_EXEC_QUEUE_RETRYING_PENDING_WARN', 50);
    const retryFail = intEnv('SELFTEST_EXEC_QUEUE_RETRYING_PENDING_FAIL', 500);

    const fail = dead >= deadFail || lagSec >= lagFail || pending >= pendingFail || retryingPending >= retryFail;
    const warn = dead >= deadWarn || lagSec >= lagWarn || pending >= pendingWarn || retryingPending >= retryWarn;

    return {
      status: fail ? 'unhealthy' : warn ? 'degraded' : 'healthy',
      details: {
        pending,
        retryingPending,
        processing: Number(m.processing || 0),
        done: Number(m.done || 0),
        dead,
        pendingLagSec: lagSec,
        oldestPendingNextAttemptAt: m.oldestPendingNextAttemptAt || null,
        thresholds: {
          deadWarn,
          deadFail,
          lagWarn,
          lagFail,
          pendingWarn,
          pendingFail,
          retryWarn,
          retryFail,
        },
      },
      error: fail ? 'exec_queue_threshold_exceeded' : null,
    };
  } catch (err) {
    return { status: 'degraded', error: err.message || 'exec_queue_check_failed' };
  }
}

async function safeCheckRedis() {
  try {
    const systemStatus = require('./systemStatusService');
    return await systemStatus.checkRedisStatus();
  } catch (err) {
    return { status: 'unhealthy', error: err.message || 'redis_check_failed' };
  }
}

async function safeCheckRag() {
  try {
    const systemStatus = require('./systemStatusService');
    return await systemStatus.checkRagServiceStatus();
  } catch (err) {
    return { status: 'unhealthy', error: err.message || 'rag_check_failed' };
  }
}

async function safeCheckEventLedger() {
  try {
    const { getEventLedgerMetrics } = require('./eventLedgerMetricsService');
    const result = await getEventLedgerMetrics({ tenantId: null });
    if (!result.ok) return { status: 'degraded', error: result.error || 'event_ledger_metrics_unavailable' };
    return {
      status: 'healthy',
      details: result.metrics,
      error: null,
    };
  } catch (err) {
    return { status: 'degraded', error: err.message || 'event_ledger_check_failed' };
  }
}

async function safeCheckEventDispatchRuntime() {
  try {
    const { getEventLedgerMetrics } = require('./eventLedgerMetricsService');
    const windowMinutes = intEnv('SELFTEST_EVENT_DISPATCH_WINDOW_MIN', 60);
    const result = await getEventLedgerMetrics({ tenantId: null, windowMinutes });
    if (!result.ok) {
      return { status: 'degraded', error: result.error || 'event_dispatch_metrics_unavailable' };
    }

    const summary = result.metrics?.dispatch?.summary || {};
    const byTarget = Array.isArray(result.metrics?.dispatch?.byTarget) ? result.metrics.dispatch.byTarget : [];
    const byTenant = Array.isArray(result.metrics?.dispatch?.byTenant) ? result.metrics.dispatch.byTenant : [];

    const baseThresholds = eventDispatchBaseThresholds();
    const tenantThresholdOverrides = parseEventDispatchTenantThresholdOverrides();

    const summaryDead = Number(summary.dead || 0);
    const summaryDeadRecent = Number(summary.deadRecent || 0);
    const summaryRetrying = Number(summary.retryingPending || 0);
    const summaryFlowTriggerFailures = Number(summary.flowTriggerFailuresRecent || 0);

    const maxLagSec = byTarget.reduce((max, item) => {
      const lag = Number(item?.pendingLagSec || 0);
      return lag > max ? lag : max;
    }, 0);

    const anyTargetFail = byTarget.some((item) => eventDispatchItemStatus(item, baseThresholds).fail);
    const anyTargetWarn = byTarget.some((item) => eventDispatchItemStatus(item, baseThresholds).warn);

    const byTenantWithStatus = byTenant.map((item) => {
      const tenantKey = String(item?.tenantKey || 'unknown');
      const thresholds = eventDispatchThresholdsForTenant(baseThresholds, tenantThresholdOverrides, tenantKey);
      const status = eventDispatchItemStatus(item, thresholds);
      return {
        tenantKey,
        pending: Number(item?.pending || 0),
        retryingPending: status.retryingPending,
        processing: Number(item?.processing || 0),
        done: Number(item?.done || 0),
        doneRecent: Number(item?.doneRecent || 0),
        dead: status.dead,
        deadRecent: status.deadRecent,
        flowTriggerFailuresRecent: status.flowTriggerFailuresRecent,
        pendingLagSec: status.lagSec,
        status: status.fail ? 'unhealthy' : status.warn ? 'degraded' : 'healthy',
        thresholds,
      };
    });
    const anyTenantFail = byTenantWithStatus.some((item) => item.status === 'unhealthy');
    const anyTenantWarn = byTenantWithStatus.some((item) => item.status === 'degraded');

    const fail =
      summaryDead >= baseThresholds.deadFail ||
      summaryDeadRecent >= baseThresholds.deadRecentFail ||
      summaryRetrying >= baseThresholds.retryFail ||
      maxLagSec >= baseThresholds.lagFail ||
      summaryFlowTriggerFailures >= baseThresholds.flowTriggerFailFail ||
      anyTargetFail ||
      anyTenantFail;

    const warn =
      summaryDead >= baseThresholds.deadWarn ||
      summaryDeadRecent >= baseThresholds.deadRecentWarn ||
      summaryRetrying >= baseThresholds.retryWarn ||
      maxLagSec >= baseThresholds.lagWarn ||
      summaryFlowTriggerFailures >= baseThresholds.flowTriggerFailWarn ||
      anyTargetWarn ||
      anyTenantWarn;

    return {
      status: fail ? 'unhealthy' : warn ? 'degraded' : 'healthy',
      details: {
        windowMinutes: Number(result.windowMinutes || windowMinutes),
        summary: {
          pending: Number(summary.pending || 0),
          retryingPending: summaryRetrying,
          processing: Number(summary.processing || 0),
          done: Number(summary.done || 0),
          doneRecent: Number(summary.doneRecent || 0),
          dead: summaryDead,
          deadRecent: summaryDeadRecent,
          flowTriggerFailuresRecent: summaryFlowTriggerFailures,
          maxPendingLagSec: maxLagSec,
        },
        byTarget: byTarget.map((item) => ({
          target: String(item?.target || 'combined'),
          pending: Number(item?.pending || 0),
          retryingPending: Number(item?.retryingPending || 0),
          processing: Number(item?.processing || 0),
          done: Number(item?.done || 0),
          doneRecent: Number(item?.doneRecent || 0),
          dead: Number(item?.dead || 0),
          deadRecent: Number(item?.deadRecent || 0),
          flowTriggerFailuresRecent: Number(item?.flowTriggerFailuresRecent || 0),
          pendingLagSec: Number(item?.pendingLagSec || 0),
        })),
        byTenant: byTenantWithStatus,
        thresholds: baseThresholds,
      },
      error: fail ? 'event_dispatch_runtime_threshold_exceeded' : null,
    };
  } catch (err) {
    return { status: 'degraded', error: err.message || 'event_dispatch_runtime_check_failed' };
  }
}

async function safeCheckFlowExecutionLedger() {
  try {
    const { getFlowExecutionLedgerMetrics } = require('./flowExecutionLedgerMetricsService');
    const windowMinutes = intEnv('SELFTEST_FLOW_EXECUTION_LEDGER_WINDOW_MIN', intEnv('FLOW_EXECUTION_LEDGER_METRICS_WINDOW_MIN', 60));
    const result = await getFlowExecutionLedgerMetrics({ tenantId: null, windowMinutes });
    if (!result.ok) return { status: 'degraded', error: result.error || 'flow_execution_ledger_metrics_unavailable' };
    const metrics = result.metrics || {};
    const failedRecent = Number(metrics.failedRecent || 0);
    const failedWarn = intEnv('SELFTEST_FLOW_EXECUTION_LEDGER_FAILED_RECENT_WARN', 5);
    const failedFail = intEnv('SELFTEST_FLOW_EXECUTION_LEDGER_FAILED_RECENT_FAIL', 50);

    const modeBreakdownAvailable = !!(metrics.recentByMode && typeof metrics.recentByMode === 'object');
    const nonSimulationRecent = Number(metrics.nonSimulationRecent || 0);
    const recent = Number(metrics.recent || 0);
    const requireRuntimeRecent = String(process.env.SELFTEST_FLOW_EXECUTION_LEDGER_REQUIRE_RUNTIME_RECENT || '1') !== '0';
    const runtimeMissing = modeBreakdownAvailable && requireRuntimeRecent && recent > 0 && nonSimulationRecent <= 0;

    const fail = failedRecent >= failedFail;
    const warn = failedRecent >= failedWarn || runtimeMissing;

    return {
      status: fail ? 'unhealthy' : warn ? 'degraded' : 'healthy',
      details: {
        ...metrics,
        thresholds: {
          failedRecentWarn: failedWarn,
          failedRecentFail: failedFail,
          requireRuntimeRecent,
        },
      },
      error: fail
        ? 'flow_execution_ledger_failed_recent_threshold_exceeded'
        : runtimeMissing
          ? 'flow_execution_ledger_no_runtime_recent'
          : null,
    };
  } catch (err) {
    return { status: 'degraded', error: err.message || 'flow_execution_ledger_check_failed' };
  }
}

async function safeCheckPbxEventRuntime() {
  try {
    const { getExecutionQueueMetricsByKind } = require('./executionQueueService');
    const queueMetrics = await getExecutionQueueMetricsByKind({
      tenantId: null,
      kinds: ['scan_pbx_cdr_events', 'dispatch_event_trigger'],
    });
    if (!queueMetrics.ok) {
      return { status: 'degraded', error: queueMetrics.error || 'pbx_event_runtime_queue_metrics_unavailable' };
    }

    const byKind = {};
    for (const item of Array.isArray(queueMetrics.items) ? queueMetrics.items : []) {
      byKind[String(item.kind || '')] = item;
    }
    const scan = byKind.scan_pbx_cdr_events || {};
    const dispatch = byKind.dispatch_event_trigger || {};

    const scanDead = Number(scan.dead || 0);
    const scanLagSec = Number(scan.pendingLagSec || 0);
    const dispatchDead = Number(dispatch.dead || 0);
    const dispatchRetrying = Number(dispatch.retryingPending || 0);

    const scanDeadWarn = intEnv('SELFTEST_PBX_EVENT_SCAN_DEAD_WARN', 1);
    const scanDeadFail = intEnv('SELFTEST_PBX_EVENT_SCAN_DEAD_FAIL', 5);
    const scanLagWarn = intEnv('SELFTEST_PBX_EVENT_SCAN_LAG_WARN_SEC', 300);
    const scanLagFail = intEnv('SELFTEST_PBX_EVENT_SCAN_LAG_FAIL_SEC', 1800);
    const dispatchDeadWarn = intEnv('SELFTEST_PBX_EVENT_DISPATCH_DEAD_WARN', 1);
    const dispatchDeadFail = intEnv('SELFTEST_PBX_EVENT_DISPATCH_DEAD_FAIL', 20);
    const dispatchRetryWarn = intEnv('SELFTEST_PBX_EVENT_DISPATCH_RETRYING_WARN', 20);
    const dispatchRetryFail = intEnv('SELFTEST_PBX_EVENT_DISPATCH_RETRYING_FAIL', 200);

    const { getSequelize } = require('../db/sequelize');
    const sequelize = getSequelize();
    let recentPbxEvents = 0;
    let flowTriggerFailuresRecent = 0;
    const windowMinutes = intEnv('SELFTEST_PBX_EVENT_WINDOW_MIN', 60);
    if (sequelize) {
      const [rows] = await sequelize.query(
        `SELECT
           COUNT(*) FILTER (
             WHERE type IN ('CallRinging', 'CallAnswered', 'CallEnded')
               AND received_at >= NOW() - INTERVAL '${Math.floor(windowMinutes)} minutes'
           ) AS recent_pbx_events
         FROM event_ledger`
      );
      const r = Array.isArray(rows) && rows[0] ? rows[0] : {};
      recentPbxEvents = Number(r.recent_pbx_events || 0);

      const [failureRows] = await sequelize.query(
        `SELECT
           COUNT(*) FILTER (
             WHERE kind = 'dispatch_event_trigger'
               AND last_error = 'event_trigger_flows_failed'
               AND updated_at >= NOW() - INTERVAL '${Math.floor(windowMinutes)} minutes'
           ) AS flow_trigger_failures_recent
         FROM execution_jobs`
      );
      const fr = Array.isArray(failureRows) && failureRows[0] ? failureRows[0] : {};
      flowTriggerFailuresRecent = Number(fr.flow_trigger_failures_recent || 0);
    }

    const flowTriggerFailWarn = intEnv('SELFTEST_PBX_EVENT_FLOW_TRIGGER_FAIL_WARN', 5);
    const flowTriggerFailFail = intEnv('SELFTEST_PBX_EVENT_FLOW_TRIGGER_FAIL_FAIL', 50);

    const fail =
      scanDead >= scanDeadFail ||
      scanLagSec >= scanLagFail ||
      dispatchDead >= dispatchDeadFail ||
      dispatchRetrying >= dispatchRetryFail ||
      flowTriggerFailuresRecent >= flowTriggerFailFail;
    const warn =
      scanDead >= scanDeadWarn ||
      scanLagSec >= scanLagWarn ||
      dispatchDead >= dispatchDeadWarn ||
      dispatchRetrying >= dispatchRetryWarn ||
      flowTriggerFailuresRecent >= flowTriggerFailWarn;

    return {
      status: fail ? 'unhealthy' : warn ? 'degraded' : 'healthy',
      details: {
        windowMinutes,
        recentPbxEvents,
        flowTriggerFailuresRecent,
        scan: {
          pending: Number(scan.pending || 0),
          retryingPending: Number(scan.retryingPending || 0),
          dead: scanDead,
          pendingLagSec: scanLagSec,
        },
        dispatch: {
          pending: Number(dispatch.pending || 0),
          retryingPending: dispatchRetrying,
          dead: dispatchDead,
          pendingLagSec: Number(dispatch.pendingLagSec || 0),
        },
        thresholds: {
          scanDeadWarn,
          scanDeadFail,
          scanLagWarn,
          scanLagFail,
          dispatchDeadWarn,
          dispatchDeadFail,
          dispatchRetryWarn,
          dispatchRetryFail,
          flowTriggerFailWarn,
          flowTriggerFailFail,
        },
      },
      error: fail ? 'pbx_event_runtime_threshold_exceeded' : null,
    };
  } catch (err) {
    return { status: 'degraded', error: err.message || 'pbx_event_runtime_check_failed' };
  }
}

async function safeCheckVoiceRuntime() {
  try {
    const windowMinutes = intEnv('SELFTEST_VOICE_RUNTIME_WINDOW_MIN', 60);
    const activeWarn = intEnv('SELFTEST_VOICE_RUNTIME_ACTIVE_SESSIONS_WARN', 100);
    const activeFail = intEnv('SELFTEST_VOICE_RUNTIME_ACTIVE_SESSIONS_FAIL', 500);
    const ingestionSilenceWarnMin = intEnv('SELFTEST_VOICE_RUNTIME_INGEST_SILENCE_WARN_MIN', 120);
    const ingestionSilenceFailMin = intEnv('SELFTEST_VOICE_RUNTIME_INGEST_SILENCE_FAIL_MIN', 720);

    const { getSequelize } = require('../db/sequelize');
    const sequelize = getSequelize();
    if (!sequelize) {
      return { status: 'degraded', error: 'db_unavailable' };
    }

    const [rows] = await sequelize.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE type IN ('VoiceCallRinging', 'VoiceCallAnswered', 'VoiceCallEnded', 'VoiceCallDtmf', 'VoiceCallTransfer')
             AND received_at >= NOW() - (:windowMinutes * INTERVAL '1 minute')
         )::int AS recent_voice_events,
         COUNT(*) FILTER (
           WHERE type IN ('VoiceCallEnded', 'CallEnded')
             AND received_at >= NOW() - (:windowMinutes * INTERVAL '1 minute')
         )::int AS recent_voice_ended
       FROM event_ledger`,
      { replacements: { windowMinutes: Number(windowMinutes) } },
    );
    const r = Array.isArray(rows) && rows[0] ? rows[0] : {};
    const recentVoiceEvents = Number(r.recent_voice_events || 0);
    const recentVoiceEnded = Number(r.recent_voice_ended || 0);

    const { getVoiceRuntimeStats } = require('./voiceRuntimeService');
    const stats = getVoiceRuntimeStats({ tenantId: null });
    const activeSessions = Number(stats?.totalSessions || 0);

    // best-effort: estima silêncio de ingestão por tenant global
    let minutesSinceLastVoiceEvent = null;
    try {
      const [lastRows] = await sequelize.query(
        `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(received_at))) / 60.0 AS minutes_since_last
         FROM event_ledger
         WHERE type IN ('VoiceCallRinging', 'VoiceCallAnswered', 'VoiceCallEnded', 'VoiceCallDtmf', 'VoiceCallTransfer')`,
      );
      const lr = Array.isArray(lastRows) && lastRows[0] ? lastRows[0] : {};
      minutesSinceLastVoiceEvent = lr.minutes_since_last != null ? Number(lr.minutes_since_last) : null;
    } catch (_) {}

    const fail =
      activeSessions >= activeFail ||
      (minutesSinceLastVoiceEvent != null && minutesSinceLastVoiceEvent >= ingestionSilenceFailMin);
    const warn =
      activeSessions >= activeWarn ||
      (minutesSinceLastVoiceEvent != null && minutesSinceLastVoiceEvent >= ingestionSilenceWarnMin);

    return {
      status: fail ? 'unhealthy' : warn ? 'degraded' : 'healthy',
      details: {
        windowMinutes,
        recentVoiceEvents,
        recentVoiceEnded,
        activeSessions,
        minutesSinceLastVoiceEvent,
        thresholds: {
          activeWarn,
          activeFail,
          ingestionSilenceWarnMin,
          ingestionSilenceFailMin,
        },
      },
      error: fail ? 'voice_runtime_threshold_exceeded' : null,
    };
  } catch (err) {
    return { status: 'degraded', error: err.message || 'voice_runtime_check_failed' };
  }
}

/**
 * Executa selftest read-only.
 *
 * @returns {Promise<{status: 'PASS'|'WARN'|'FAIL', checks: object, meta: object}>}
 */
async function runSelftest() {
  const startedAt = Date.now();

  const [db, redis, rag, publicTokens, executionQueue, eventLedger, eventDispatchRuntime, flowExecutionLedger, pbxEventRuntime, voiceRuntime] = await Promise.all([
    safeCheckDb(),
    safeCheckRedis(),
    safeCheckRag(),
    safeCheckPublicTokens(),
    safeCheckExecutionQueue(),
    safeCheckEventLedger(),
    safeCheckEventDispatchRuntime(),
    safeCheckFlowExecutionLedger(),
    safeCheckPbxEventRuntime(),
    safeCheckVoiceRuntime(),
  ]);

  const checks = { db, redis, rag, publicTokens, executionQueue, eventLedger, eventDispatchRuntime, flowExecutionLedger, pbxEventRuntime, voiceRuntime };
  const values = Object.values(checks);

  const anyUnhealthy = values.some((c) => c && c.status === 'unhealthy');
  const anyDegraded = values.some((c) => c && c.status === 'degraded');

  // status executivo (para monitoramento)
  let status = 'PASS';
  if (anyUnhealthy) status = 'FAIL';
  else if (anyDegraded) status = 'WARN';

  const result = {
    status,
    checks,
    meta: {
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      nodeEnv: process.env.NODE_ENV || 'development',
    },
  };

  // best-effort: loga apenas resumo
  try {
    logger.info('[Selftest] concluído', { status: result.status, durationMs: result.meta.durationMs });
  } catch (_) {}

  return result;
}

module.exports = { runSelftest };
