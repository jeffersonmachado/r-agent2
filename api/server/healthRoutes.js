'use strict';

function buildDbHealthPayload({ connectionCheck, dbInfo, migrationStatus, syncStatus, environment }) {
  return {
    environment,
    latencyMs: connectionCheck.latencyMs,
    db: dbInfo,
    migrations: {
      applied: migrationStatus.appliedCount,
      pending: migrationStatus.pendingCount,
      pendingNames: migrationStatus.pendingNames,
    },
    sync: syncStatus,
  };
}

async function handleDbHealth({ res, sendJson, logger }) {
  try {
    const dbHealth = require('../db/health');
    const connectionCheck = await dbHealth.checkDbConnection();
    const dbInfo = dbHealth.getDbInfo();
    const migrationStatus = await dbHealth.getMigrationStatusSafe();
    const syncStatus = dbHealth.getSyncStatus();
    const environment = dbHealth.getEnvironment();

    if (!connectionCheck.ok) {
      sendJson(res, 503, {
        status: 'fail',
        ...buildDbHealthPayload({ connectionCheck, dbInfo, migrationStatus, syncStatus, environment }),
        errorMessage: connectionCheck.errorMessage,
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    sendJson(res, 200, {
      status: 'ok',
      ...buildDbHealthPayload({ connectionCheck, dbInfo, migrationStatus, syncStatus, environment }),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[Health DB] Erro ao verificar banco de dados:', err);
    const dbHealth = require('../db/health');
    sendJson(res, 503, {
      status: 'fail',
      environment: dbHealth.getEnvironment(),
      latencyMs: 0,
      db: dbHealth.getDbInfo(),
      migrations: {
        applied: 0,
        pending: 0,
        pendingNames: [],
      },
      errorMessage: err.message || 'Erro ao verificar banco de dados',
      timestamp: new Date().toISOString(),
    });
  }
  return true;
}

async function handleReadyHealth({ res, sendJson, logger }) {
  try {
    const dbHealth = require('../db/health');
    const connectionCheck = await dbHealth.checkDbConnection();

    if (!connectionCheck.ok) {
      sendJson(res, 503, {
        status: 'not_ready',
        reason: 'db_connection_failed',
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    const migrationStatus = await dbHealth.getMigrationStatusSafe();
    if (migrationStatus.pendingCount > 0) {
      sendJson(res, 503, {
        status: 'not_ready',
        reason: 'migrations_pending',
        pending: migrationStatus.pendingCount,
        pendingNames: migrationStatus.pendingNames,
        timestamp: new Date().toISOString(),
      });
      return true;
    }

    sendJson(res, 200, {
      status: 'ready',
      db: 'ok',
      migrationsPending: 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[Health Ready] Erro ao verificar readiness:', err);
    sendJson(res, 503, {
      status: 'not_ready',
      reason: 'check_failed',
      error: err.message || 'Erro ao verificar readiness',
      timestamp: new Date().toISOString(),
    });
  }
  return true;
}

async function handleSelftest({ res, sendJson, logger }) {
  try {
    const { runSelftest } = require('../services/selftestService');
    const result = await runSelftest();
    sendJson(res, result.status === 'FAIL' ? 503 : 200, result);
  } catch (err) {
    logger.error('[Selftest] Erro ao executar selftest:', err);
    sendJson(res, 503, {
      status: 'FAIL',
      error: err.message || 'selftest_failed',
      meta: { timestamp: new Date().toISOString() },
    });
  }
  return true;
}

async function handleHealthRoutes({
  res,
  method,
  pathname,
  sendJson,
  logger,
  apiVersionInfo,
  nodeEnv,
}) {
  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return true;
  }

  if (method === 'GET' && pathname === '/health/live') {
    sendJson(res, 200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.floor(process.uptime()),
    });
    return true;
  }

  if (method === 'GET' && pathname === '/health/db') {
    return handleDbHealth({ res, sendJson, logger });
  }

  if (method === 'GET' && (pathname === '/health/ready' || pathname === '/ready')) {
    return handleReadyHealth({ res, sendJson, logger });
  }

  if (method === 'GET' && (pathname === '/health/selftest' || pathname === '/selftest')) {
    return handleSelftest({ res, sendJson, logger });
  }

  if (method === 'GET' && pathname === '/version') {
    sendJson(res, 200, {
      name: apiVersionInfo.name,
      version: apiVersionInfo.version,
      serverVersion: apiVersionInfo.serverVersion,
      packageVersion: apiVersionInfo.packageVersion,
      versionMismatch: apiVersionInfo.versionMismatch,
      baseVersion: apiVersionInfo.baseVersion,
      commit: apiVersionInfo.commit,
      build: apiVersionInfo.build,
      env: nodeEnv,
    });
    return true;
  }

  return false;
}

module.exports = {
  handleHealthRoutes,
  _internal: {
    buildDbHealthPayload,
    handleDbHealth,
    handleReadyHealth,
    handleSelftest,
  },
};
