const { getSequelize } = require('../db/sequelize');

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

async function pruneFlowExecutionLedger({ retentionDays = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const days = retentionDays != null ? Number(retentionDays) : intEnv('FLOW_EXECUTION_LEDGER_RETENTION_DAYS', 30);
  if (!Number.isFinite(days) || days <= 0) return { ok: false, reason: 'invalid_retention_days' };

  const cutoffDays = Math.floor(days);

  const [deletedNodes] = await sequelize.query(
    `DELETE FROM node_executions
     WHERE execution_id IN (
       SELECT id FROM flow_executions
       WHERE started_at < NOW() - INTERVAL '${cutoffDays} days'
     )`,
  );

  const [deletedExecs] = await sequelize.query(
    `DELETE FROM flow_executions
     WHERE started_at < NOW() - INTERVAL '${cutoffDays} days'`,
  );

  return {
    ok: true,
    retentionDays: cutoffDays,
    result: { nodes: deletedNodes || null, executions: deletedExecs || null },
  };
}

module.exports = { pruneFlowExecutionLedger };
