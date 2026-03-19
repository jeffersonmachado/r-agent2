'use strict';

/**
 * Vertical Scheduler Service
 *
 * Periodically discovers active tenants (via AccessMembership + VerticalJourneyEvent)
 * and enqueues journey automation jobs for Beauty and Fitness verticals.
 *
 * Design:
 * - Uses the existing executionQueueService to enqueue jobs with idempotency keys
 * - Idempotency prevents duplicate jobs for the same tenant + tick window
 * - Runs as a lightweight setInterval (no DB polling overhead for the scheduler itself)
 * - All actual work is done asynchronously in the executionQueueService worker
 *
 * Job kinds enqueued:
 *   vertical_beauty_journey_tick      – reminder dispatch, no-show scan
 *   vertical_fitness_journey_tick     – inactivity scan, grace expiry scan
 *   vertical_beauty_reactivation_scan – periodic reactivation candidates
 *
 * Controlled by env:
 *   ENABLE_VERTICAL_SCHEDULER=true (default true in production)
 *   VERTICAL_SCHEDULER_INTERVAL_MS=60000 (default 60s)
 */

const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const { AccessMembership, VerticalJourneyEvent } = require('../../db/models');
const { enqueueJob } = require('../executionQueueService');

let _timer = null;
let _running = false;

function dbAvailable() {
  return !!getSequelize();
}

/**
 * Discover all distinct tenant_keys that have active vertical data.
 * Capped at 200 tenants per tick to avoid runaway scans.
 */
async function discoverActiveTenants() {
  if (!dbAvailable()) return [];

  const tenantSets = await Promise.all([
    AccessMembership().findAll({
      where: { vertical: { [require('sequelize').Op.in]: ['beauty', 'fitness'] } },
      attributes: ['tenant_key'],
      group: ['tenant_key'],
      limit: 200,
    }).catch(() => []),

    VerticalJourneyEvent().findAll({
      attributes: ['tenant_key'],
      group: ['tenant_key'],
      limit: 200,
    }).catch(() => []),
  ]);

  const all = new Set();
  for (const rows of tenantSets) {
    for (const r of rows) {
      const d = r.toJSON ? r.toJSON() : r;
      if (d.tenant_key) all.add(String(d.tenant_key));
    }
  }
  return Array.from(all);
}

async function tick() {
  if (!dbAvailable()) return;

  let tenants;
  try {
    tenants = await discoverActiveTenants();
  } catch (err) {
    logger.warn('[VerticalScheduler] tenant discovery failed', { error: err?.message });
    return;
  }

  if (!tenants.length) return;

  // Build an idempotency key based on tick window (minute granularity)
  const minute = Math.floor(Date.now() / 60000);

  for (const tenantId of tenants) {
    // Beauty tick (every minute)
    enqueueJob({
      tenantId,
      kind: 'vertical_beauty_journey_tick',
      payload: { tenantId },
      runAt: new Date(),
      priority: 0,
      maxAttempts: 3,
      idempotencyKey: `v_beauty_tick:${tenantId}:${minute}`,
    }).catch(() => {});

    // Fitness tick (every minute)
    enqueueJob({
      tenantId,
      kind: 'vertical_fitness_journey_tick',
      payload: { tenantId },
      runAt: new Date(),
      priority: 0,
      maxAttempts: 3,
      idempotencyKey: `v_fitness_tick:${tenantId}:${minute}`,
    }).catch(() => {});

    // Beauty reactivation scan: once per hour (idempotency key at hour granularity)
    const hour = Math.floor(Date.now() / 3600000);
    enqueueJob({
      tenantId,
      kind: 'vertical_beauty_reactivation_scan',
      payload: { tenantId },
      runAt: new Date(),
      priority: 0,
      maxAttempts: 2,
      idempotencyKey: `v_beauty_reactivation:${tenantId}:${hour}`,
    }).catch(() => {});

    // Reconciliation: once per 6 hours (stale-attendance cleanup + membership consistency)
    const sixHour = Math.floor(Date.now() / (6 * 3600000));
    enqueueJob({
      tenantId,
      kind: 'vertical_reconciliation',
      payload: { tenantId },
      runAt: new Date(),
      priority: -1, // below normal
      maxAttempts: 2,
      idempotencyKey: `v_reconciliation:${tenantId}:${sixHour}`,
    }).catch(() => {});
  }
}

function startVerticalScheduler({ intervalMs = 60000 } = {}) {
  if (_running) return;
  if (!dbAvailable()) {
    logger.warn('[VerticalScheduler] DB indisponível, scheduler não iniciado');
    return;
  }
  _running = true;
  _timer = setInterval(() => {
    tick().catch((err) => {
      logger.warn('[VerticalScheduler] tick error (ignored)', { error: err?.message });
    });
  }, Math.max(10000, Number(intervalMs) || 60000));
  _timer.unref(); // allow process to exit cleanly (Jest, graceful shutdown)

  logger.info('[VerticalScheduler] iniciado', { action: 'start', intervalMs });
}

function stopVerticalScheduler() {
  _running = false;
  if (_timer) clearInterval(_timer);
  _timer = null;
}

module.exports = {
  startVerticalScheduler,
  stopVerticalScheduler,
  tick,
};
