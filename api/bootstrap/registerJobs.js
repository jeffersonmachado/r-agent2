'use strict';

function createJobRegistrar({
  logger,
  config,
  outboundWorker,
  scheduleRemindersWorker,
  platformHealthCheckJob,
  startMaintenanceTasks,
  stopMaintenanceTasks,
  startAutoReturnToBot,
  stopAutoReturnToBot,
  startAssignmentWorker,
  stopAssignmentWorker,
  getQrRunner,
}) {
  let backgroundServicesStarted = false;

  function shouldStartNonEssentialServices() {
    if (process.env.NODE_ENV === 'test') return false;
    return String(process.env.DISABLE_NON_ESSENTIAL_SERVICES || 'false').toLowerCase() !== 'true';
  }

  async function startBackgroundServices() {
    if (backgroundServicesStarted) return;

    if (process.env.ENABLE_OUTBOUND_WORKER !== 'false') {
      try {
        outboundWorker.start({ intervalMs: 1500, batchSize: 25 });
      } catch (err) {
        logger.warn('[OutboundQueue] Falha ao iniciar worker (ignorado)', { error: err.message });
      }
    }

    if (String(process.env.ENABLE_SCHEDULE_REMINDERS_WORKER || 'false').toLowerCase() === 'true') {
      try {
        const intervalMs = parseInt(process.env.SCHEDULE_REMINDERS_WORKER_INTERVAL_MS || '60000', 10);
        const batchSize = parseInt(process.env.SCHEDULE_REMINDERS_WORKER_BATCH_SIZE || '50', 10);
        scheduleRemindersWorker.start({ intervalMs, batchSize });
      } catch (err) {
        logger.warn('[ScheduleRemindersWorker] Falha ao iniciar worker (ignorado)', { error: err.message });
      }
    }

    if (String(process.env.ENABLE_OCC_HEALTH_JOB || 'false').toLowerCase() === 'true') {
      try {
        const intervalMs = parseInt(process.env.OCC_HEALTH_INTERVAL_MS || '300000', 10);
        platformHealthCheckJob.start({ intervalMs });
      } catch (err) {
        logger.warn('[PlatformHealthCheckJob] Falha ao iniciar worker (ignorado)', { error: err.message });
      }
    }

    try {
      const { startRagConsistencyWorker } = require('../services/ragConsistencyWorker');
      startRagConsistencyWorker();
    } catch (err) {
      logger.warn('[RAGReconcile] Falha ao iniciar worker (ignorado)', { error: err.message });
    }

    if (process.env.ENABLE_AUTO_RETURN_TO_BOT !== 'false') {
      const inactivityMinutes = parseInt(process.env.AUTO_RETURN_TO_BOT_MINUTES || '30', 10);
      try {
        startAutoReturnToBot({ inactivityMinutes, intervalMs: 15000 });
      } catch (err) {
        logger.warn('[Handover] Falha ao iniciar autoReturnToBot (ignorado)', { error: err.message });
      }
    }

    if (process.env.ENABLE_ASSIGNMENT_WORKER !== 'false') {
      try {
        startAssignmentWorker({ intervalMs: 15000 });
      } catch (err) {
        logger.warn('[Assignment] Falha ao iniciar worker (ignorado)', { error: err.message });
      }
    }

    if (process.env.ENABLE_CHANNEL_HEALTH_MONITOR !== 'false') {
      try {
        const { startChannelHealthMonitor } = require('../services/channelHealthService');
        const intervalMs = parseInt(process.env.CHANNEL_HEALTH_MONITOR_INTERVAL_MS || '60000', 10);
        const windowMinutes = parseInt(process.env.CHANNEL_HEALTH_WINDOW_MINUTES || '10', 10);
        const failRateThreshold = parseFloat(process.env.CHANNEL_HEALTH_FAIL_RATE_THRESHOLD || '0.15');
        const minSamples = parseInt(process.env.CHANNEL_HEALTH_MIN_SAMPLES || '20', 10);
        const cooldownMinutes = parseInt(process.env.CHANNEL_HEALTH_COOLDOWN_MINUTES || '10', 10);
        startChannelHealthMonitor({ intervalMs, windowMinutes, failRateThreshold, minSamples, cooldownMinutes });
      } catch (err) {
        logger.warn('[ChannelHealth] Falha ao iniciar monitor (ignorado)', { error: err.message });
      }
    }

    if (process.env.ENABLE_EXECUTION_WORKER !== 'false') {
      try {
        const { startExecutionQueueWorker } = require('../services/executionQueueService');
        const intervalMs = parseInt(process.env.EXECUTION_WORKER_INTERVAL_MS || '800', 10);
        startExecutionQueueWorker({ intervalMs });
      } catch (err) {
        logger.warn('[ExecutionQueue] Falha ao iniciar worker (ignorado)', { error: err.message });
      }
    }

    if (process.env.ENABLE_SCHEDULER_WORKER !== 'false') {
      try {
        const { startScheduler } = require('../services/schedulerService');
        const intervalMs = parseInt(process.env.SCHEDULER_INTERVAL_MS || '2000', 10);
        startScheduler({ intervalMs, batchSize: 10 });
      } catch (err) {
        logger.warn('[Scheduler] Falha ao iniciar scheduler (ignorado)', { error: err.message });
      }
    }

    try {
      const { restoreWhatsAppQrSessions } = require('../services/whatsappQrRunnerBootstrapService');
      await restoreWhatsAppQrSessions().catch((err) => {
        logger.warn('[WhatsAppQR] Falha ao restaurar sessões do runner (ignorado)', { error: err?.message || String(err) });
      });
    } catch (err) {
      logger.warn('[WhatsAppQR] Bootstrap de restore indisponível (ignorado)', { error: err?.message || String(err) });
    }

    try {
      const { startWhatsAppQrBridge } = require('../services/whatsappQrBridgeService');
      await startWhatsAppQrBridge().catch((err) => {
        logger.warn('[WhatsAppQRBridge] Falha ao iniciar bridge (ignorado)', { error: err?.message || String(err) });
      });
    } catch (err) {
      logger.warn('[WhatsAppQRBridge] Bridge indisponível (ignorado)', { error: err?.message || String(err) });
    }

    backgroundServicesStarted = true;
  }

  async function stopBackgroundServices() {
    if (!backgroundServicesStarted) return;

    try { outboundWorker.stop(); } catch (_) {}
    try { scheduleRemindersWorker.stop(); } catch (_) {}
    try { platformHealthCheckJob.stop(); } catch (_) {}
    try { require('../services/executionQueueService').stopExecutionQueueWorker(); } catch (_) {}
    try { require('../services/schedulerService').stopScheduler(); } catch (_) {}
    try { stopAutoReturnToBot(); } catch (_) {}
    try { stopAssignmentWorker(); } catch (_) {}
    try { require('../services/channelHealthService').stopChannelHealthMonitor(); } catch (_) {}
    try { require('../services/ragConsistencyWorker').stopRagConsistencyWorker(); } catch (_) {}
    try { await require('../services/whatsappQrBridgeService').stopWhatsAppQrBridge(); } catch (_) {}
    try { await getQrRunner()?.stopAllSessions?.(); } catch (_) {}

    backgroundServicesStarted = false;
  }

  async function startJobs() {
    if (!shouldStartNonEssentialServices()) {
      logger.info('[Server] Serviços não essenciais desabilitados para o ambiente atual');
      return;
    }
    startMaintenanceTasks();
    await startBackgroundServices();
  }

  async function stopJobs() {
    stopMaintenanceTasks();
    await stopBackgroundServices();
  }

  return {
    shouldStartNonEssentialServices,
    startBackgroundServices,
    stopBackgroundServices,
    startJobs,
    stopJobs,
  };
}

module.exports = {
  createJobRegistrar,
};
