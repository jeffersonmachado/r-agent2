'use strict';

function startWorkers({
  logger,
  outboundWorker,
  startAutoCleanup,
  ticketCleanupIntervalHours = 1,
  ticketMaxAgeDays = 7,
  startAutoReturnToBot,
  startAssignmentWorker,
  processRef = process,
}) {
  // WhatsApp QR Bridge initialization (best-effort).
  if (processRef.env.ENABLE_WHATSAPP_QR_BRIDGE !== 'false') {
    try {
      const { startWhatsAppQrBridge } = require('../services/whatsappQrBridgeService');
      startWhatsAppQrBridge().then(result => {
        if (result?.ok) logger.info('[WhatsAppQRBridge] ✅ Iniciado', result);
      }).catch((err) => {
        logger.warn('[WhatsAppQRBridge] Falha', { error: err?.message });
      });
    } catch (err) {
      logger.warn('[WhatsAppQRBridge] Erro', { error: err?.message });
    }
  }

  // Worker outbound (best-effort) - inicia após DB + migrations.
  if (processRef.env.ENABLE_OUTBOUND_WORKER !== 'false') {
    try {
      outboundWorker.start({ intervalMs: 1500, batchSize: 25 });
    } catch (err) {
      logger.warn('[OutboundQueue] Falha ao iniciar worker (ignorado)', { error: err.message });
    }
  }

  if (typeof startAutoCleanup === 'function' && processRef.env.ENABLE_TICKET_AUTO_CLEANUP !== 'false') {
    try {
      startAutoCleanup(ticketCleanupIntervalHours, ticketMaxAgeDays);
    } catch (err) {
      logger.warn('[QueueService] Falha ao iniciar limpeza automatica de tickets (ignorado)', { error: err.message });
    }
  }

  // Auto-return-to-bot (best-effort).
  if (processRef.env.ENABLE_AUTO_RETURN_TO_BOT !== 'false') {
    const inactivityMinutes = parseInt(processRef.env.AUTO_RETURN_TO_BOT_MINUTES || '30', 10);
    try {
      startAutoReturnToBot({ inactivityMinutes, intervalMs: 15000 });
    } catch (err) {
      logger.warn('[Handover] Falha ao iniciar autoReturnToBot (ignorado)', { error: err.message });
    }
  }

  // Assignment worker (reassign offline) - best-effort.
  if (processRef.env.ENABLE_ASSIGNMENT_WORKER !== 'false') {
    try {
      startAssignmentWorker({ intervalMs: 15000 });
    } catch (err) {
      logger.warn('[Assignment] Falha ao iniciar worker (ignorado)', { error: err.message });
    }
  }

  // Execution Queue Worker (dispatch_event_trigger jobs) - best-effort.
  if (processRef.env.ENABLE_EXECUTION_QUEUE_WORKER !== 'false') {
    try {
      const { startExecutionQueueWorker } = require('../services/executionQueueService');
      startExecutionQueueWorker({ intervalMs: 800 });
    } catch (err) {
      logger.warn('[ExecutionQueue] Falha ao iniciar worker (ignorado)', { error: err.message });
    }
  }

  // Vertical journey scheduler (beauty + fitness automation) - best-effort.
  if (processRef.env.ENABLE_VERTICAL_SCHEDULER !== 'false') {
    try {
      const { startVerticalScheduler } = require('../services/vertical/verticalSchedulerService');
      const verticalIntervalMs = parseInt(processRef.env.VERTICAL_SCHEDULER_INTERVAL_MS || '60000', 10);
      startVerticalScheduler({ intervalMs: verticalIntervalMs });
    } catch (err) {
      logger.warn('[VerticalScheduler] Falha ao iniciar (ignorado)', { error: err.message });
    }
  }

  // Channel Health monitor (best-effort).
  if (processRef.env.ENABLE_CHANNEL_HEALTH_MONITOR !== 'false') {
    try {
      const { startChannelHealthMonitor } = require('../services/channelHealthService');
      const intervalMs = parseInt(processRef.env.CHANNEL_HEALTH_MONITOR_INTERVAL_MS || '60000', 10);
      const windowMinutes = parseInt(processRef.env.CHANNEL_HEALTH_WINDOW_MINUTES || '10', 10);
      const failRateThreshold = parseFloat(processRef.env.CHANNEL_HEALTH_FAIL_RATE_THRESHOLD || '0.15');
      const minSamples = parseInt(processRef.env.CHANNEL_HEALTH_MIN_SAMPLES || '20', 10);
      const cooldownMinutes = parseInt(processRef.env.CHANNEL_HEALTH_COOLDOWN_MINUTES || '10', 10);
      startChannelHealthMonitor({ intervalMs, windowMinutes, failRateThreshold, minSamples, cooldownMinutes });
    } catch (err) {
      logger.warn('[ChannelHealth] Falha ao iniciar monitor (ignorado)', { error: err.message });
    }
  }
}

module.exports = {
  startWorkers,
};
