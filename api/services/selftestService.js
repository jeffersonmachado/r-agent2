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

/**
 * Executa selftest read-only.
 *
 * @returns {Promise<{status: 'PASS'|'WARN'|'FAIL', checks: object, meta: object}>}
 */
async function runSelftest() {
  const startedAt = Date.now();

  const [db, redis, rag, publicTokens, executionQueue] = await Promise.all([
    safeCheckDb(),
    safeCheckRedis(),
    safeCheckRag(),
    safeCheckPublicTokens(),
    safeCheckExecutionQueue(),
  ]);

  const checks = { db, redis, rag, publicTokens, executionQueue };
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

