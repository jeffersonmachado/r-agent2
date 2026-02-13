/**
 * Execution Queue (DB-first) - internal jobs
 *
 * Goals:
 * - Provide a minimal execution queue decoupled from outbound messaging.
 * - Enable scheduler + operational scans (SLA, pruning, etc.).
 */

'use strict';

const crypto = require('crypto');
const os = require('os');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { ExecutionJob } = require('../db/models');
const { checkRateLimit } = require('../../infra/rate-limit');

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function getProcessingBy() {
  return `${os.hostname()}:${process.pid}`;
}

function intEnv(name, def) {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function boolEnv(name, def = false) {
  const raw = process.env[name];
  if (raw === undefined) return def;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return def;
}

async function enqueueJob({
  tenantId = 'system',
  kind,
  payload = {},
  runAt = null,
  priority = 0,
  maxAttempts = 5,
  idempotencyKey = null,
}) {
  if (!kind || typeof kind !== 'string') throw new Error('kind_required');
  if (!dbAvailable()) {
    const err = new Error('db_unavailable');
    // @ts-ignore
    err.code = 'db_unavailable';
    throw err;
  }

  const Model = ExecutionJob();
  const now = new Date();
  const nextAttemptAt = runAt ? new Date(runAt) : now;

  // Quota por tenant (jobs/min) - usa rate limiting (Redis) em produção.
  // Em dev/test, rate limiting retorna allowed=true.
  const quotaEnabled = boolEnv('EXECUTION_QUEUE_QUOTA_ENABLED', true);
  if (quotaEnabled && String(tenantId) !== 'system') {
    try {
      const rl = await checkRateLimit({
        userId: `tenant:${String(tenantId)}`,
        operationType: 'EXECUTION_QUEUE_ENQUEUE',
      });
      if (!rl.allowed) {
        const err = new Error('exec_queue_quota_exceeded');
        // @ts-ignore
        err.code = 'exec_queue_quota_exceeded';
        // @ts-ignore
        err.retryAfter = rl.retryAfter || 60;
        throw err;
      }
    } catch (err) {
      // Se o rate limiter falhar, não bloqueia por enquanto (best-effort),
      // mas loga como alerta operacional.
      if (String(err?.code || '') === 'exec_queue_quota_exceeded') throw err;
      logger.warn('[ExecutionQueue] Falha ao aplicar quota por tenant (ignored)', { tenantId, error: err.message });
    }
  }

  const row = await Model.create({
    id: newId('job'),
    tenant_key: String(tenantId),
    kind: String(kind),
    status: 'pending',
    priority: Number(priority) || 0,
    payload: payload && typeof payload === 'object' ? payload : {},
    attempts: 0,
    max_attempts: Number(maxAttempts) || 5,
    next_attempt_at: nextAttemptAt,
    processing_at: null,
    processing_by: null,
    last_error: null,
    idempotency_key: idempotencyKey ? String(idempotencyKey) : null,
    created_at: now,
    updated_at: now,
  }).catch(async (err) => {
    // Unique violation on idempotency: return existing
    const isUnique = String(err?.original?.code || '') === '23505';
    if (idempotencyKey && isUnique) {
      const existing = await Model.findOne({
        where: { tenant_key: String(tenantId), kind: String(kind), idempotency_key: String(idempotencyKey) },
        order: [['created_at', 'DESC']],
      });
      return existing;
    }
    throw err;
  });

  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

async function claimNextJob({ kinds = null, maxProcessingPerTenant = null, staleProcessingSec = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return null;

  const processingBy = getProcessingBy();
  const kindsFilter = Array.isArray(kinds) && kinds.length ? kinds.map((k) => String(k)) : null;

  const maxProc =
    Number.isFinite(Number(maxProcessingPerTenant)) && Number(maxProcessingPerTenant) > 0
      ? Math.floor(Number(maxProcessingPerTenant))
      : intEnv('EXECUTION_QUEUE_MAX_PROCESSING_PER_TENANT', 5);
  const staleSec =
    Number.isFinite(Number(staleProcessingSec)) && Number(staleProcessingSec) > 0
      ? Math.floor(Number(staleProcessingSec))
      : intEnv('EXECUTION_QUEUE_STALE_PROCESSING_SECONDS', 15 * 60);

  // Use SKIP LOCKED to allow multiple workers.
  const replacements = { processingBy, maxProc, staleSec };
  let kindsSql = '';
  if (kindsFilter) {
    kindsSql = `AND kind = ANY(:kinds)`;
    replacements.kinds = kindsFilter;
  }

  const [rows] = await sequelize.query(
    `WITH cte AS (
       SELECT id
       FROM execution_jobs
       WHERE status = 'pending'
         AND next_attempt_at <= NOW()
         ${kindsSql}
         AND (
           SELECT COUNT(*)
           FROM execution_jobs p
           WHERE p.tenant_key = execution_jobs.tenant_key
             AND p.status = 'processing'
             AND p.processing_at >= NOW() - (:staleSec || ' seconds')::interval
         ) < :maxProc
       ORDER BY priority DESC, next_attempt_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE execution_jobs j
     SET status = 'processing',
         processing_at = NOW(),
         processing_by = :processingBy,
         updated_at = NOW()
     FROM cte
     WHERE j.id = cte.id
     RETURNING j.*;`,
    { replacements },
  );

  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function releaseStaleProcessingJobs({ staleProcessingSec = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { released: 0 };
  const staleSec =
    Number.isFinite(Number(staleProcessingSec)) && Number(staleProcessingSec) > 0
      ? Math.floor(Number(staleProcessingSec))
      : intEnv('EXECUTION_QUEUE_STALE_PROCESSING_SECONDS', 15 * 60);

  // Jobs que ficaram "processing" por muito tempo voltam para pending.
  // Best-effort: evita travar a fila por crash de worker.
  const [rows] = await sequelize.query(
    `UPDATE execution_jobs
     SET status = 'pending',
         processing_at = NULL,
         processing_by = NULL,
         updated_at = NOW()
     WHERE status = 'processing'
       AND processing_at IS NOT NULL
       AND processing_at < NOW() - (:staleSec || ' seconds')::interval
     RETURNING id;`,
    { replacements: { staleSec } },
  );
  return { released: Array.isArray(rows) ? rows.length : 0 };
}

async function finishJob({ jobId, status, errorMessage = null, backoffSeconds = null }) {
  const sequelize = getSequelize();
  if (!sequelize) return;

  if (status === 'done') {
    await sequelize.query(
      `UPDATE execution_jobs
       SET status='done', last_error=NULL, updated_at=NOW()
       WHERE id = :id`,
      { replacements: { id: jobId } },
    );
    return;
  }

  // failed → retry or dead
  const [rows] = await sequelize.query(
    `SELECT id, attempts, max_attempts
     FROM execution_jobs
     WHERE id = :id
     LIMIT 1`,
    { replacements: { id: jobId } },
  );
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  const attempts = Number(row?.attempts || 0) + 1;
  const maxAttempts = Number(row?.max_attempts || 5);

  if (attempts >= maxAttempts) {
    await sequelize.query(
      `UPDATE execution_jobs
       SET status='dead',
           attempts = :attempts,
           last_error = :err,
           updated_at = NOW()
       WHERE id = :id`,
      { replacements: { id: jobId, attempts, err: errorMessage ? String(errorMessage) : null } },
    );
    return;
  }

  const backoff = Number(backoffSeconds) > 0 ? Number(backoffSeconds) : Math.min(60 * attempts, 300);
  await sequelize.query(
    `UPDATE execution_jobs
     SET status='pending',
         attempts = :attempts,
         next_attempt_at = NOW() + (:backoff || ' seconds')::interval,
         last_error = :err,
         processing_at = NULL,
         processing_by = NULL,
         updated_at = NOW()
     WHERE id = :id`,
    {
      replacements: {
        id: jobId,
        attempts,
        backoff,
        err: errorMessage ? String(errorMessage) : null,
      },
    },
  );
}

async function listDeadJobs({ tenantId, kind = null, limit = 100, offset = 0 } = {}) {
  const Model = ExecutionJob();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const where = {
    tenant_key: String(tenantId || 'system'),
    status: 'dead',
  };
  if (kind) where.kind = String(kind);

  const { count, rows } = await Model.findAndCountAll({
    where,
    order: [['updated_at', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  });

  return {
    total: count,
    items: (rows || []).map((r) => (r.toJSON ? r.toJSON() : r)),
    limit: safeLimit,
    offset: safeOffset,
  };
}

async function retryDeadJob({ tenantId, jobId } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };
  const tid = String(tenantId || 'system');
  const id = String(jobId || '');
  if (!id) return { ok: false, error: 'job_id_required' };

  const [rows] = await sequelize.query(
    `UPDATE execution_jobs
     SET status = 'pending',
         attempts = 0,
         next_attempt_at = NOW(),
         last_error = NULL,
         processing_at = NULL,
         processing_by = NULL,
         updated_at = NOW()
     WHERE id = :id
       AND tenant_key = :tenantKey
       AND status = 'dead'
     RETURNING *;`,
    { replacements: { id, tenantKey: tid } },
  );
  const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!row) return { ok: false, error: 'dead_job_not_found' };
  return { ok: true, job: row };
}

async function getExecutionQueueMetrics({ tenantId = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };

  const replacements = {};
  const whereTenant = tenantId ? 'WHERE tenant_key = :tenantKey' : '';
  if (tenantId) replacements.tenantKey = String(tenantId);

  const [rows] = await sequelize.query(
    `WITH base AS (
       SELECT *
       FROM execution_jobs
       ${whereTenant}
     )
     SELECT
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'pending' AND attempts > 0) AS retrying_pending,
       COUNT(*) FILTER (WHERE status = 'processing') AS processing,
       COUNT(*) FILTER (WHERE status = 'done') AS done,
       COUNT(*) FILTER (WHERE status = 'dead') AS dead,
       MIN(next_attempt_at) FILTER (WHERE status = 'pending') AS oldest_pending_next_attempt_at
     FROM base;`,
    { replacements },
  );

  const r = Array.isArray(rows) && rows[0] ? rows[0] : {};
  const oldest = r.oldest_pending_next_attempt_at ? new Date(r.oldest_pending_next_attempt_at) : null;
  const lagSec = oldest ? Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 1000)) : 0;

  return {
    ok: true,
    metrics: {
      pending: Number(r.pending || 0),
      retryingPending: Number(r.retrying_pending || 0),
      processing: Number(r.processing || 0),
      done: Number(r.done || 0),
      dead: Number(r.dead || 0),
      pendingLagSec: lagSec,
      oldestPendingNextAttemptAt: oldest ? oldest.toISOString() : null,
    },
  };
}

async function getExecutionQueueMetricsByKind({ tenantId = null, kinds = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };

  const replacements = {};
  const whereTenant = tenantId ? 'tenant_key = :tenantKey' : '1=1';
  if (tenantId) replacements.tenantKey = String(tenantId);

  const kindsFilter = Array.isArray(kinds) && kinds.length ? kinds.map((k) => String(k)) : null;
  const kindsSql = kindsFilter ? 'AND kind = ANY(:kinds)' : '';
  if (kindsFilter) replacements.kinds = kindsFilter;

  const [rows] = await sequelize.query(
    `SELECT kind,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending,
            COUNT(*) FILTER (WHERE status = 'pending' AND attempts > 0) AS retrying_pending,
            COUNT(*) FILTER (WHERE status = 'processing') AS processing,
            COUNT(*) FILTER (WHERE status = 'done') AS done,
            COUNT(*) FILTER (WHERE status = 'dead') AS dead,
            MIN(next_attempt_at) FILTER (WHERE status = 'pending') AS oldest_pending_next_attempt_at
       FROM execution_jobs
      WHERE ${whereTenant}
        ${kindsSql}
      GROUP BY kind
      ORDER BY kind ASC`,
    { replacements },
  );

  const items = (Array.isArray(rows) ? rows : []).map((r) => {
    const oldest = r.oldest_pending_next_attempt_at ? new Date(r.oldest_pending_next_attempt_at) : null;
    const lagSec = oldest ? Math.max(0, Math.floor((Date.now() - oldest.getTime()) / 1000)) : 0;
    return {
      kind: String(r.kind || ''),
      pending: Number(r.pending || 0),
      retryingPending: Number(r.retrying_pending || 0),
      processing: Number(r.processing || 0),
      done: Number(r.done || 0),
      dead: Number(r.dead || 0),
      pendingLagSec: lagSec,
      oldestPendingNextAttemptAt: oldest ? oldest.toISOString() : null,
    };
  });

  return { ok: true, items };
}

// Worker management
let _timer = null;
let _running = false;
let _lastStaleReleaseAt = 0;

async function processJob(job) {
  const kind = String(job.kind || '');
  if (kind === 'scan_sla') {
    const { runSlaScan } = require('./opsSlaService');
    await runSlaScan();
    return;
  }
  if (kind === 'scan_pbx_cdr_events') {
    const { scanPbxCdrAndEmitEvents } = require('./pbx/pbxCallEventsService');
    const consumer = job?.payload?.consumer || 'pbx_cdr_v0';
    const batchSize = job?.payload?.batchSize || 200;
    await scanPbxCdrAndEmitEvents({ consumer, batchSize });
    return;
  }
  if (kind === 'prune_event_ledger') {
    const { pruneEventLedger } = require('./pruneEventLedgerService');
    const days = intEnv('EVENT_LEDGER_RETENTION_DAYS', 30);
    await pruneEventLedger({ retentionDays: days });
    return;
  }
  if (kind === 'prune_flow_execution_ledger') {
    const { pruneFlowExecutionLedger } = require('./pruneFlowExecutionLedgerService');
    const days = intEnv('FLOW_EXECUTION_LEDGER_RETENTION_DAYS', 30);
    await pruneFlowExecutionLedger({ retentionDays: days });
    return;
  }
  if (kind === 'scan_event_triggers') {
    const { scanAndEnqueue } = require('./eventLedgerTriggerDispatcher');
    const consumer = job?.payload?.consumer || 'webhooks_v1';
    const batchSize = job?.payload?.batchSize || 100;
    const dispatchTargets = Array.isArray(job?.payload?.dispatchTargets) ? job.payload.dispatchTargets : null;
    await scanAndEnqueue({ consumer, batchSize, dispatchTargets });
    return;
  }
  if (kind === 'dispatch_event_trigger') {
    const { dispatchOne } = require('./eventLedgerTriggerDispatcher');
    const tenantId = job?.tenant_key || job?.tenantId || 'system';
    const consumer = job?.payload?.consumer || 'webhooks_v1';
    const eventId = job?.payload?.eventId || null;
    const dispatchTargets = Array.isArray(job?.payload?.dispatchTargets) ? job.payload.dispatchTargets : null;
    const out = await dispatchOne({ tenantId, consumer, eventId, dispatchTargets });
    if (!out.ok && out.reason === 'event_not_found') {
      // Nada a fazer (idempotente): marca como done
      return;
    }
    if (!out.ok) {
      const err = new Error(out.reason || 'dispatch_failed');
      // @ts-ignore
      err.code = out.reason || 'dispatch_failed';
      throw err;
    }
    return;
  }
  // Unknown kind: mark as done (best-effort)
  logger.warn('[ExecutionQueue] Job kind desconhecido, ignorando', { kind, jobId: job.id });
}

function startExecutionQueueWorker({ intervalMs = 800 } = {}) {
  if (_running) return;
  if (!dbAvailable()) {
    logger.warn('[ExecutionQueue] DB indisponível, worker não iniciado');
    return;
  }
  _running = true;
  const tick = async () => {
    if (!_running) return;
    try {
      // Best-effort: libera jobs "travados" em processing (a cada ~30s)
      const now = Date.now();
      if (now - _lastStaleReleaseAt > 30_000) {
        _lastStaleReleaseAt = now;
        await releaseStaleProcessingJobs().catch(() => {});
      }

      const job = await claimNextJob();
      if (!job) return;
      try {
        await processJob(job);
        await finishJob({ jobId: job.id, status: 'done' });
      } catch (err) {
        await finishJob({ jobId: job.id, status: 'failed', errorMessage: err.message || String(err) });
      }
    } catch (err) {
      logger.warn('[ExecutionQueue] tick failed (ignored)', { error: err.message });
    }
  };
  _timer = setInterval(() => { tick(); }, Math.max(200, Number(intervalMs) || 800));
  logger.info('[ExecutionQueue] worker iniciado', { intervalMs });
}

function stopExecutionQueueWorker() {
  _running = false;
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = {
  enqueueJob,
  claimNextJob,
  finishJob,
  releaseStaleProcessingJobs,
  listDeadJobs,
  retryDeadJob,
  getExecutionQueueMetrics,
  getExecutionQueueMetricsByKind,
  startExecutionQueueWorker,
  stopExecutionQueueWorker,
};
