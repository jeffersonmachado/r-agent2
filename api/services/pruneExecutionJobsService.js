'use strict';

/**
 * Retenção de execution_jobs.
 *
 * Jobs finalizados (`done`) ou mortos (`dead`) acumulam sem limite e derrubam o
 * check `executionQueue` do selftest (`dead >= SELFTEST_EXEC_QUEUE_DEAD_FAIL`).
 * Este serviço remove apenas jobs finalizados/mortos mais antigos que a janela
 * de retenção; jobs `pending`/`processing` nunca são tocados.
 */

const { getSequelize } = require('../db/sequelize');

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

async function pruneExecutionJobs({ retentionDays = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const days = retentionDays != null ? Number(retentionDays) : intEnv('EXECUTION_JOB_RETENTION_DAYS', 30);
  if (!Number.isFinite(days) || days <= 0) return { ok: false, reason: 'invalid_retention_days' };

  // updated_at reflete a finalização (done/dead). Pending/processing ficam.
  const [res] = await sequelize.query(
    `DELETE FROM execution_jobs
     WHERE status IN ('done', 'dead')
       AND updated_at < NOW() - INTERVAL '${Math.floor(days)} days'`,
  );

  return { ok: true, retentionDays: Math.floor(days), result: res || null };
}

module.exports = { pruneExecutionJobs };
