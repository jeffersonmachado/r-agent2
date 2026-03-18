/**
 * Scheduler v1 (interval-based) - emits ScheduledTriggerFired and enqueues jobs.
 */

'use strict';

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { Schedule } = require('../db/models');
const { enqueueJob } = require('./executionQueueService');
const { appendEventV1 } = require('./eventLedgerService');
const { Op } = require('sequelize');

// ── defensive helpers ────────────────────────────────────────────────────────
function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return safeToString(err, fallback); }
}
// ─────────────────────────────────────────────────────────────────────────────

function dbAvailable() {
  return !!getSequelize();
}

function nextRunDate(now, intervalSec) {
  const sec = Number(intervalSec) || 60;
  return new Date(now.getTime() + Math.max(5, sec) * 1000);
}

async function tickScheduler({ batchSize = 10 } = {}) {
  if (!dbAvailable()) return;

  const Model = Schedule();
  const now = new Date();
  const due = await Model.findAll({
    where: {
      enabled: true,
      next_run_at: { [Op.lte]: now },
    },
    order: [['next_run_at', 'ASC']],
    limit: Number(batchSize) || 10,
  }).catch(() => []);

  for (const s of due || []) {
    const schedule = s.toJSON ? s.toJSON() : s;
    const tenantId = schedule.tenant_key || 'system';
    const kind = safeToString(schedule.kind).trim();
    if (!kind) continue;
    const payload = schedule.payload || {};

    try {
      // emit event (best-effort)
      await appendEventV1({
        tenantId,
        type: 'ScheduledTriggerFired',
        source: 'scheduler',
        occurredAt: now,
        correlationId: `sched:${schedule.id}`,
        subject: { type: 'schedule', id: schedule.id },
        actor: { type: 'system', id: 'scheduler' },
        idempotencyKey: `scheduled_trigger:${schedule.id}:${safeToString(schedule.next_run_at)}`,
        payload: { scheduleId: schedule.id, kind, name: schedule.name || null },
      }).catch(() => {});

      await enqueueJob({
        tenantId,
        kind,
        payload,
        runAt: now,
        priority: 0,
        maxAttempts: 5,
        idempotencyKey: `sched_job:${schedule.id}:${safeToString(schedule.next_run_at)}`,
      }).catch(() => {});
    } catch (_) {}

    // update schedule next run
    try {
      const next = nextRunDate(now, schedule.interval_sec || 60);
      await s.update({
        last_run_at: now,
        next_run_at: next,
      });
    } catch (err) {
      logger.warn('[Scheduler] failed to update schedule (ignored)', { id: schedule.id, error: safeErrorMessage(err) });
    }
  }
}

let _timer = null;
let _running = false;

function startScheduler({ intervalMs = 2000, batchSize = 10 } = {}) {
  if (_running) return;
  if (!dbAvailable()) {
    logger.warn('[Scheduler] DB indisponível, scheduler não iniciado');
    return;
  }
  _running = true;
  const tick = async () => {
    if (!_running) return;
    try {
      await tickScheduler({ batchSize });
    } catch (err) {
      logger.warn('[Scheduler] tick failed (ignored)', { error: safeErrorMessage(err) });
    }
  };
  _timer = setInterval(() => { tick(); }, Math.max(500, Number(intervalMs) || 2000));
  logger.info('[Scheduler] iniciado', { intervalMs });
}

function stopScheduler() {
  _running = false;
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = {
  startScheduler,
  stopScheduler,
  tickScheduler,
};

