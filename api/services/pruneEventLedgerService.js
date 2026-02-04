const { getSequelize } = require('../db/sequelize');

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

async function pruneEventLedger({ retentionDays = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, reason: 'db_unavailable' };

  const days = retentionDays != null ? Number(retentionDays) : intEnv('EVENT_LEDGER_RETENTION_DAYS', 30);
  if (!Number.isFinite(days) || days <= 0) return { ok: false, reason: 'invalid_retention_days' };

  const [res] = await sequelize.query(
    `DELETE FROM event_ledger
     WHERE occurred_at < NOW() - INTERVAL '${Math.floor(days)} days'`,
  );

  // Sequelize returns dialect-specific; we just return ok.
  return { ok: true, retentionDays: Math.floor(days), result: res || null };
}

module.exports = { pruneEventLedger };

