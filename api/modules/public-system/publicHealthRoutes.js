'use strict';

async function handlePublicHealthRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, logger, config } = deps;

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
    try {
      const dbHealth = require('../../db/health');
      const connectionCheck = await dbHealth.checkDbConnection();
      const dbInfo = dbHealth.getDbInfo();
      const migrationStatus = await dbHealth.getMigrationStatusSafe();
      const syncStatus = dbHealth.getSyncStatus();
      const environment = dbHealth.getEnvironment();

      if (!connectionCheck.ok) {
        sendJson(res, 503, {
          status: 'fail',
          environment,
          latencyMs: connectionCheck.latencyMs,
          db: dbInfo,
          migrations: {
            applied: migrationStatus.appliedCount,
            pending: migrationStatus.pendingCount,
            pendingNames: migrationStatus.pendingNames,
          },
          sync: syncStatus,
          errorMessage: connectionCheck.errorMessage,
          timestamp: new Date().toISOString(),
        });
        return true;
      }

      sendJson(res, 200, {
        status: 'ok',
        environment,
        latencyMs: connectionCheck.latencyMs,
        db: dbInfo,
        migrations: {
          applied: migrationStatus.appliedCount,
          pending: migrationStatus.pendingCount,
          pendingNames: migrationStatus.pendingNames,
        },
        sync: syncStatus,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('[Health DB] Erro ao verificar banco de dados:', err);
      const dbHealth = require('../../db/health');
      sendJson(res, 503, {
        status: 'fail',
        environment: dbHealth.getEnvironment(),
        latencyMs: 0,
        db: dbHealth.getDbInfo(),
        migrations: { applied: 0, pending: 0, pendingNames: [] },
        errorMessage: err.message || 'Erro ao verificar banco de dados',
        timestamp: new Date().toISOString(),
      });
    }
    return true;
  }

  async function handleReady() {
    try {
      const dbHealth = require('../../db/health');
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

  if (method === 'GET' && (pathname === '/health/ready' || pathname === '/ready')) {
    return handleReady();
  }

  if (method === 'GET' && (pathname === '/health/selftest' || pathname === '/selftest')) {
    try {
      const { runSelftest } = require('../../services/selftestService');
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

  if (method === 'GET' && pathname === '/version') {
    // Versão pública mínima: name/version/env. Detalhes de runtime (pid,
    // uptime, versão exata do Node) e do banco (string completa do
    // SELECT version()) só são expostos a principal autenticado com
    // classificação DEVELOPMENT (super_admin) — fingerprinting em endpoint
    // público seria information disclosure. Consumidor: página
    // "Versões da Stack" (/dev/stack-versions, restrita a super_admin).
    let packageVersion = 'unknown';
    try {
      // Resolve o package.json raiz do pacote chatbot-engine.
      packageVersion = require('../../../package.json').version || 'unknown';
    } catch {
      packageVersion = 'unknown';
    }

    const payload = {
      name: 'RAP',
      version: packageVersion,
      env: config.get('nodeEnv', 'development'),
      timestamp: new Date().toISOString(),
    };

    let privileged = false;
    try {
      const authResult = typeof deps.requireAuth === 'function'
        ? deps.requireAuth(req)
        : { valid: false };
      if (authResult.valid && authResult.agent) {
        const { isSuperAdmin } = require('../../services/superAdminService');
        privileged = isSuperAdmin(authResult.agent) === true;
      }
    } catch {
      privileged = false;
    }

    if (privileged) {
      payload.runtime = {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptimeSec: Math.floor(process.uptime()),
      };

      // Versão do servidor de banco (PostgreSQL) — best-effort e não
      // bloqueante: se o banco estiver lento ou indisponível, o /version
      // continua respondendo com os dados de API/runtime.
      try {
        const sequelizeModule = require('../../db/sequelize');
        const getSequelize = sequelizeModule && sequelizeModule.getSequelize;
        const sequelize = typeof getSequelize === 'function' ? getSequelize() : null;
        if (sequelize) {
          const result = await Promise.race([
            sequelize.query('SELECT version() AS version'),
            new Promise((resolve) => setTimeout(() => resolve(null), 2500)),
          ]);
          if (result) {
            const rows = Array.isArray(result) ? result[0] : result;
            const firstRow = rows && rows[0];
            if (firstRow && firstRow.version) {
              payload.database = { serverVersion: firstRow.version };
            }
          }
        }
      } catch {
        // Best-effort: não inclui database se a consulta falhar.
      }
    }

    sendJson(res, 200, payload);
    return true;
  }

  return false;
}

module.exports = { handlePublicHealthRoutes };
