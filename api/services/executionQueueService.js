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

// ── defensive helpers ────────────────────────────────────────────────────────
function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeGet(obj, path, fallback = null) {
  if (!obj || typeof obj !== 'object') return fallback;
  try {
    const parts = path.split('.');
    let v = obj;
    for (const part of parts) {
      v = v?.[part];
      if (v === undefined) return fallback;
    }
    return v ?? fallback;
  } catch (_) { return fallback; }
}

function safeArrayFilter(arr, predicate) {
  if (!Array.isArray(arr)) return [];
  try {
    return arr.filter(item => {
      try { return predicate(item); } catch (_) { return false; }
    });
  } catch (_) { return []; }
}

// Fail-closed: job sem tenant não pode executar como 'system'. Lança erro
// explícito (o worker registra last_error='tenant_required' e aplica retry/dead
// conforme attempts) sem fazer dispatch.
function throwJobTenantRequired(kind, job) {
  logger.warn('[ExecutionQueue] job sem tenant — falhando sem dispatch', {
    kind: safeToString(kind),
    jobId: safeToString(safeGet(job, 'id', '')),
  });
  const err = new Error('tenant_required');
  // @ts-ignore
  err.code = 'tenant_required';
  throw err;
}
// ─────────────────────────────────────────────────────────────────────────────

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
  if (quotaEnabled && safeToString(tenantId) !== 'system') {
    try {
      const rl = await checkRateLimit({
        userId: `tenant:${safeToString(tenantId)}`,
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
      if (safeToString(safeGet(err, 'code', '')) === 'exec_queue_quota_exceeded') throw err;
      logger.warn('[ExecutionQueue] Falha ao aplicar quota por tenant (ignored)', { tenantId, error: safeToString(safeGet(err, 'message', '')) || safeToString(err) });
    }
  }

  const row = await Model.create({
    id: newId('job'),
    tenant_key: safeToString(tenantId),
    kind: safeToString(kind),
    status: 'pending',
    priority: Number(priority) || 0,
    payload: payload && typeof payload === 'object' ? payload : {},
    attempts: 0,
    max_attempts: Number(maxAttempts) || 5,
    next_attempt_at: nextAttemptAt,
    processing_at: null,
    processing_by: null,
    last_error: null,
    idempotency_key: idempotencyKey ? safeToString(idempotencyKey) : null,
    created_at: now,
    updated_at: now,
  }).catch(async (err) => {
    // Unique violation on idempotency: return existing
    const isUnique = safeToString(safeGet(err, 'original.code', '')) === '23505';
    if (idempotencyKey && isUnique) {
      const existing = await Model.findOne({
        where: { tenant_key: safeToString(tenantId), kind: safeToString(kind), idempotency_key: safeToString(idempotencyKey) },
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
  const kindsFilter = Array.isArray(kinds) && kinds.length ? kinds.map((k) => safeToString(k)) : null;

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
  const attempts = Number(safeGet(row, 'attempts', 0)) + 1;
  const maxAttempts = Number(safeGet(row, 'max_attempts', 5));

  if (attempts >= maxAttempts) {
    await sequelize.query(
      `UPDATE execution_jobs
       SET status='dead',
           attempts = :attempts,
           last_error = :err,
           updated_at = NOW()
       WHERE id = :id`,
      { replacements: { id: jobId, attempts, err: errorMessage ? safeToString(errorMessage) : null } },
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
        err: errorMessage ? safeToString(errorMessage) : null,
      },
    },
  );
}

async function listDeadJobs({ tenantId, kind = null, limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  // Fail-closed: sem tenant explícito, não consultar a DLQ como 'system'.
  if (!safeToString(tenantId)) {
    return { ok: false, error: 'tenant_required', total: 0, items: [], limit: safeLimit, offset: safeOffset };
  }
  const Model = ExecutionJob();
  const where = {
    tenant_key: safeToString(tenantId),
    status: 'dead',
  };
  if (kind) where.kind = safeToString(kind);

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
  // Fail-closed: sem tenant explícito, não reenfileirar como 'system'.
  const tid = safeToString(tenantId);
  if (!tid) return { ok: false, error: 'tenant_required' };
  const id = safeToString(jobId || '');
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
  const row = Array.isArray(rows) ? rows[0] || null : null;
  if (!row) return { ok: false, error: 'dead_job_not_found' };
  return { ok: true, job: row };
}

async function getExecutionQueueMetrics({ tenantId = null } = {}) {
  const sequelize = getSequelize();
  if (!sequelize) return { ok: false, error: 'db_unavailable' };

  const replacements = {};
  const whereTenant = tenantId ? 'WHERE tenant_key = :tenantKey' : '';
  if (tenantId) replacements.tenantKey = safeToString(tenantId);

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

  const r = Array.isArray(rows) ? rows[0] || {} : {};
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
  if (tenantId) replacements.tenantKey = safeToString(tenantId);

  const kindsFilter = Array.isArray(kinds) && kinds.length ? kinds.map((k) => safeToString(k)) : null;
  // IN (:kinds) é a forma correta para Sequelize com arrays; ANY(:kinds) gera sintaxe inválida.
  const kindsSql = kindsFilter ? 'AND kind IN (:kinds)' : '';
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
      kind: safeToString(r.kind || ''),
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
  const kind = safeToString(safeGet(job, 'kind', ''));
  if (kind === 'scan_sla') {
    const { runSlaScan } = require('./opsSlaService');
    await runSlaScan();
    return;
  }
  if (kind === 'learning_adaptive_cycle') {
    const { runScheduledCycle } = require('../modules/learning-core/adaptiveCycleService');
    // Fail-closed: job sem tenant não executa como 'system' — falha explícita.
    const tenantId = safeGet(job, 'payload.tenantId') || safeGet(job, 'tenant_key');
    if (!tenantId) throwJobTenantRequired(kind, job);
    await runScheduledCycle({ tenantId });
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
  if (kind === 'prune_execution_jobs') {
    const { pruneExecutionJobs } = require('./pruneExecutionJobsService');
    const days = intEnv('EXECUTION_JOB_RETENTION_DAYS', 30);
    await pruneExecutionJobs({ retentionDays: days });
    return;
  }
  if (kind === 'scan_event_triggers') {
    const { scanAndEnqueue } = require('./eventLedgerTriggerDispatcher');
    const consumer = safeGet(job, 'payload.consumer', 'webhooks_v1');
    const batchSize = safeGet(job, 'payload.batchSize', 100);
    const dispatchTargets = Array.isArray(safeGet(job, 'payload.dispatchTargets')) ? safeGet(job, 'payload.dispatchTargets') : null;
    await scanAndEnqueue({ consumer, batchSize, dispatchTargets });
    return;
  }
  if (kind === 'dispatch_event_trigger') {
    const { dispatchOne } = require('./eventLedgerTriggerDispatcher');
    // Fail-closed: job sem tenant não executa como 'system' — falha explícita.
    const tenantId = safeGet(job, 'tenant_key') || safeGet(job, 'tenantId');
    if (!tenantId) throwJobTenantRequired(kind, job);
    const consumer = safeGet(job, 'payload.consumer', 'webhooks_v1');
    const eventId = safeGet(job, 'payload.eventId', null);
    const dispatchTargets = Array.isArray(safeGet(job, 'payload.dispatchTargets')) ? safeGet(job, 'payload.dispatchTargets') : null;
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
  if (kind === 'vertical_notification_dispatch' || kind === 'vertical_notification_send') {
    const { dispatchNotification } = require('./notificationService');
    // Fail-closed: job sem tenant não executa como 'system' — falha explícita.
    const tenantId = safeGet(job, 'payload.tenantId') || safeGet(job, 'tenant_key');
    if (!tenantId) throwJobTenantRequired(kind, job);
    const notificationId = safeGet(job, 'payload.notificationId', null);
    const fallbackPayload = notificationId ? null : {
      tenantId,
      recipient: safeGet(job, 'payload.recipient', null) || safeGet(job, 'payload.to', null),
      channel: safeGet(job, 'payload.channel', null) || safeGet(job, 'payload.metadata.channel', null) || 'whatsapp',
      eventType: safeGet(job, 'payload.eventType', 'unknown_event'),
      message: safeGet(job, 'payload.message', null),
      metadata: safeGet(job, 'payload.metadata', {}),
      vertical: safeGet(job, 'payload.vertical', null) || safeGet(job, 'payload.metadata.vertical', null),
      subjectId: safeGet(job, 'payload.subjectId', null) || safeGet(job, 'payload.metadata.subjectId', null),
      customerId: safeGet(job, 'payload.customerId', null) || safeGet(job, 'payload.metadata.customerId', null),
      membershipId: safeGet(job, 'payload.membershipId', null) || safeGet(job, 'payload.metadata.membershipId', null),
      bundleId: safeGet(job, 'payload.bundleId', null) || safeGet(job, 'payload.metadata.bundleId', null),
      transactionId: safeGet(job, 'payload.transactionId', null) || safeGet(job, 'payload.metadata.transactionId', null),
      appointmentId: safeGet(job, 'payload.appointmentId', null) || safeGet(job, 'payload.metadata.appointmentId', null),
      scheduleId: safeGet(job, 'payload.scheduleId', null) || safeGet(job, 'payload.metadata.scheduleId', null),
      maxAttempts: safeGet(job, 'max_attempts', 3),
    };
    const result = await dispatchNotification({
      tenantId,
      notificationId,
      jobId: safeGet(job, 'id', null),
      force: !!safeGet(job, 'payload.force', false),
      fallbackPayload,
    });
    if (!result?.ok) {
      const err = new Error(result?.error || 'vertical_notification_send_failed');
      // @ts-ignore
      err.code = 'vertical_notification_send_failed';
      throw err;
    }
    return;
  }
  if (kind === 'billing_reconciliation') {
    const { reconcileTransactions, reconcileSubscriptions } = require('./billingService');
    const { appendEventV1 } = require('./eventLedgerService');
    const tenantId = safeGet(job, 'payload.tenantId') || safeGet(job, 'tenant_key') || null;
    const limit = Number(safeGet(job, 'payload.limit', 100)) || 100;
    const [txOut, subOut] = await Promise.all([
      reconcileTransactions({ tenantId, limit }),
      reconcileSubscriptions({ tenantId, limit }),
    ]);
    if (!txOut?.ok || !subOut?.ok) {
      const err = new Error('billing_reconciliation_failed');
      // @ts-ignore
      err.code = 'billing_reconciliation_failed';
      throw err;
    }
    if (tenantId) {
      appendEventV1({
        tenantId,
        type: 'VerticalJourney_Custom',
        source: 'billing.reconciliation.scheduler',
        correlationId: job?.id || null,
        subject: { type: 'tenant', id: tenantId },
        actor: { type: 'system', id: 'execution_queue' },
        payload: {
          kind: 'billing_reconciliation_scheduled',
          limit,
          jobId: job?.id || null,
          transactions: txOut,
          subscriptions: subOut,
        },
      }).catch((err) => {
        logger.warn('[ExecutionQueue] billing reconciliation snapshot append failed', {
          error: err?.message,
          tenantId,
          jobId: job?.id || null,
        });
      });
    }
    return;
  }
  // Vertical journey kinds (beauty + fitness)
  if (kind.startsWith('vertical_')) {
    const { handleVerticalJob } = require('./vertical/verticalJourneyJobHandler');
    const handled = await handleVerticalJob(job);
    if (handled) return;
  }
  // Integration Hub (R-Bridge) kinds — usa a MESMA fila canônica
  // (retry/backoff/DLQ/concorrência por tenant/idempotência já existentes).
  if (kind.startsWith('integration_')) {
    const { handleIntegrationJob } = require('./integration/integrationJobHandler');
    const handled = await handleIntegrationJob(job);
    if (handled) return;
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
        await finishJob({ jobId: job.id, status: 'failed', errorMessage: safeToString(safeGet(err, 'message', '')) || safeToString(err) });
      }
    } catch (err) {
      logger.warn('[ExecutionQueue] tick failed (ignored)', { error: safeToString(safeGet(err, 'message', '')) || safeToString(err) });
    }
  };
  _timer = setInterval(() => { tick(); }, Math.max(200, Number(intervalMs) || 800));
  _timer.unref(); // allow process to exit cleanly (Jest, graceful shutdown)
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
