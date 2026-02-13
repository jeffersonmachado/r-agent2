const { getSequelize } = require('../db/sequelize');

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

async function getEventLedgerMetrics({ windowMinutes = null, tenantId = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };

  const minutes = windowMinutes != null ? Number(windowMinutes) : intEnv('EVENT_LEDGER_METRICS_WINDOW_MIN', 60);
  if (!Number.isFinite(minutes) || minutes <= 0) return { ok: false, error: 'invalid_window_minutes' };

  const whereTenant = tenantId ? 'WHERE tenant_key = :tenantKey' : '';
  const replacements = {};
  if (tenantId) replacements.tenantKey = String(tenantId);

  const [rows] = await sequelize.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '${Math.floor(minutes)} minutes') AS recent
     FROM event_ledger
     ${whereTenant}`,
    { replacements },
  );

  const r = Array.isArray(rows) && rows[0] ? rows[0] : {};
  const [dispatchRows] = await sequelize.query(
    `WITH base AS (
       SELECT
         status,
         attempts,
         next_attempt_at,
         updated_at,
         COALESCE(NULLIF(payload->'dispatchTargets'->>0, ''), 'combined') AS dispatch_target
       FROM execution_jobs
       WHERE kind = 'dispatch_event_trigger'
         ${tenantId ? 'AND tenant_key = :tenantKey' : ''}
     )
     SELECT
       dispatch_target,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'pending' AND attempts > 0) AS retrying_pending,
       COUNT(*) FILTER (WHERE status = 'processing') AS processing,
       COUNT(*) FILTER (WHERE status = 'done') AS done,
       COUNT(*) FILTER (WHERE status = 'dead') AS dead,
       COUNT(*) FILTER (
         WHERE status = 'dead'
           AND updated_at >= NOW() - INTERVAL '${Math.floor(minutes)} minutes'
       ) AS dead_recent,
       COUNT(*) FILTER (
         WHERE status = 'done'
           AND updated_at >= NOW() - INTERVAL '${Math.floor(minutes)} minutes'
       ) AS done_recent,
       COUNT(*) FILTER (WHERE last_error = 'event_trigger_flows_failed') AS flow_trigger_failures_total,
       COUNT(*) FILTER (
         WHERE last_error = 'event_trigger_flows_failed'
           AND updated_at >= NOW() - INTERVAL '${Math.floor(minutes)} minutes'
       ) AS flow_trigger_failures_recent,
       MIN(next_attempt_at) FILTER (WHERE status = 'pending') AS oldest_pending_next_attempt_at
     FROM base
     GROUP BY dispatch_target
     ORDER BY dispatch_target ASC`,
    { replacements },
  );
  const byTarget = (Array.isArray(dispatchRows) ? dispatchRows : []).map((row) => {
    const oldest = row.oldest_pending_next_attempt_at ? new Date(row.oldest_pending_next_attempt_at) : null;
    const lagSec = oldest ? Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 1000)) : 0;
    return {
      target: String(row.dispatch_target || 'combined'),
      pending: Number(row.pending || 0),
      retryingPending: Number(row.retrying_pending || 0),
      processing: Number(row.processing || 0),
      done: Number(row.done || 0),
      dead: Number(row.dead || 0),
      doneRecent: Number(row.done_recent || 0),
      deadRecent: Number(row.dead_recent || 0),
      flowTriggerFailuresTotal: Number(row.flow_trigger_failures_total || 0),
      flowTriggerFailuresRecent: Number(row.flow_trigger_failures_recent || 0),
      pendingLagSec: lagSec,
      oldestPendingNextAttemptAt: oldest ? oldest.toISOString() : null,
    };
  });
  const dispatchSummary = byTarget.reduce((acc, item) => ({
    pending: acc.pending + item.pending,
    retryingPending: acc.retryingPending + item.retryingPending,
    processing: acc.processing + item.processing,
    done: acc.done + item.done,
    dead: acc.dead + item.dead,
    doneRecent: acc.doneRecent + item.doneRecent,
    deadRecent: acc.deadRecent + item.deadRecent,
    flowTriggerFailuresTotal: acc.flowTriggerFailuresTotal + item.flowTriggerFailuresTotal,
    flowTriggerFailuresRecent: acc.flowTriggerFailuresRecent + item.flowTriggerFailuresRecent,
  }), {
    pending: 0,
    retryingPending: 0,
    processing: 0,
    done: 0,
    dead: 0,
    doneRecent: 0,
    deadRecent: 0,
    flowTriggerFailuresTotal: 0,
    flowTriggerFailuresRecent: 0,
  });

  return {
    ok: true,
    windowMinutes: Math.floor(minutes),
    tenantId: tenantId ? String(tenantId) : null,
    metrics: {
      total: Number(r.total || 0),
      recent: Number(r.recent || 0),
      dispatch: {
        summary: dispatchSummary,
        byTarget,
      },
    },
  };
}

module.exports = { getEventLedgerMetrics };
