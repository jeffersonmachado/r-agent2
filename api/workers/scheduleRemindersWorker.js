'use strict';

const logger = require('../utils/logger');
const { processDueRemindersBatch } = require('../services/scheduleRemindersService');

let timer = null;
let running = false;

function parseIntervalMs() {
  const raw = Number(process.env.SCHEDULE_REMINDERS_WORKER_INTERVAL_MS || 60000);
  if (Number.isFinite(raw) && raw >= 10000) return Math.trunc(raw);
  return 60000;
}

async function tick(batchSize) {
  if (running) return;
  running = true;
  try {
    const out = await processDueRemindersBatch({ limit: batchSize });
    if ((out.done || 0) > 0 || (out.failed || 0) > 0) {
      logger.info('[ScheduleRemindersWorker] ciclo processado', {
        locked: out.locked,
        done: out.done,
        failed: out.failed,
      });
    }
  } catch (err) {
    logger.error('[ScheduleRemindersWorker] erro no ciclo', { error: err.message });
  } finally {
    running = false;
  }
}

function start({ intervalMs = null, batchSize = 50 } = {}) {
  if (timer) return;
  const safeInterval = Number.isFinite(Number(intervalMs)) ? Number(intervalMs) : parseIntervalMs();
  const safeBatch = Math.min(Math.max(Number(batchSize) || 50, 1), 200);

  timer = setInterval(() => {
    tick(safeBatch).catch(() => null);
  }, safeInterval);

  if (typeof timer.unref === 'function') timer.unref();
  tick(safeBatch).catch(() => null);

  logger.info('[ScheduleRemindersWorker] iniciado', {
    intervalMs: safeInterval,
    batchSize: safeBatch,
  });
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  logger.info('[ScheduleRemindersWorker] parado');
}

module.exports = {
  start,
  stop,
};
