const { getSequelize } = require('../db/sequelize');

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

async function getFlowExecutionLedgerMetrics({ windowMinutes = null, tenantId = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };

  const minutes = windowMinutes != null ? Number(windowMinutes) : intEnv('FLOW_EXECUTION_LEDGER_METRICS_WINDOW_MIN', 60);
  if (!Number.isFinite(minutes) || minutes <= 0) return { ok: false, error: 'invalid_window_minutes' };

  const whereTenant = tenantId ? 'WHERE tenant_key = :tenantKey' : '';
  const replacements = {};
  if (tenantId) replacements.tenantKey = String(tenantId);

  const [rows] = await sequelize.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '${Math.floor(minutes)} minutes') AS recent,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed_total,
       COUNT(*) FILTER (
         WHERE status = 'failed'
           AND started_at >= NOW() - INTERVAL '${Math.floor(minutes)} minutes'
       ) AS failed_recent
     FROM flow_executions
     ${whereTenant}`,
    { replacements },
  );
  const [modeRows] = await sequelize.query(
    `SELECT
       COALESCE(NULLIF(meta->>'mode', ''), 'unknown') AS mode,
       COUNT(*) FILTER (WHERE started_at >= NOW() - INTERVAL '${Math.floor(minutes)} minutes') AS recent
     FROM flow_executions
     ${whereTenant}
     GROUP BY COALESCE(NULLIF(meta->>'mode', ''), 'unknown')
     ORDER BY mode ASC`,
    { replacements },
  );

  const r = Array.isArray(rows) && rows[0] ? rows[0] : {};
  const recentByMode = {};
  for (const row of Array.isArray(modeRows) ? modeRows : []) {
    const key = String(row?.mode || 'unknown');
    recentByMode[key] = Number(row?.recent || 0);
  }
  const nonSimulationRecent = Object.entries(recentByMode).reduce((acc, [mode, count]) => {
    if (mode === 'simulation') return acc;
    return acc + Number(count || 0);
  }, 0);

  return {
    ok: true,
    windowMinutes: Math.floor(minutes),
    tenantId: tenantId ? String(tenantId) : null,
    metrics: {
      total: Number(r.total || 0),
      recent: Number(r.recent || 0),
      failedTotal: Number(r.failed_total || 0),
      failedRecent: Number(r.failed_recent || 0),
      recentByMode,
      nonSimulationRecent: Number(nonSimulationRecent || 0),
    },
  };
}

module.exports = { getFlowExecutionLedgerMetrics };
