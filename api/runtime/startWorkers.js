'use strict';

// Handles dos workers iniciados por startWorkers (para stopWorkers no shutdown).
let ticketCleanupIntervalId = null;
let outboundWorkerRef = null;

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
  outboundWorkerRef = outboundWorker || null;
  // Playwright browser check (best-effort): validators de runtime/RPA dependem
  // do Chromium do Playwright; avisa cedo se o cache de browsers foi apagado.
  if (processRef.env.ENABLE_PLAYWRIGHT_BOOT_CHECK !== 'false') {
    try {
      const { checkPlaywrightBrowser } = require('./playwrightBrowserCheck');
      checkPlaywrightBrowser({ logger }).catch((err) => {
        logger.warn('[PlaywrightBootCheck] Falha inesperada no check (ignorado)', { error: err?.message });
      });
    } catch (err) {
      logger.warn('[PlaywrightBootCheck] Erro ao iniciar check (ignorado)', { error: err?.message });
    }
  }

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
      ticketCleanupIntervalId = startAutoCleanup(ticketCleanupIntervalHours, ticketMaxAgeDays);
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

  // Generic scheduler (tabela schedules -> execution queue) - best-effort.
  if (processRef.env.ENABLE_SCHEDULER !== 'false') {
    try {
      const { startScheduler } = require('../services/schedulerService');
      const schedulerIntervalMs = parseInt(processRef.env.SCHEDULER_INTERVAL_MS || '2000', 10);
      startScheduler({ intervalMs: schedulerIntervalMs });
    } catch (err) {
      logger.warn('[Scheduler] Falha ao iniciar (ignorado)', { error: err.message });
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

  // Marketing Google Ads scheduler (best-effort).
  if (processRef.env.ENABLE_MARKETING_GOOGLE_ADS_SCHEDULER !== 'false') {
    try {
      const { startMarketingGoogleAdsScheduler } = require('../services/marketing/googleAdsRecommendationSchedulerService');
      const intervalMs = parseInt(processRef.env.MARKETING_GOOGLE_ADS_SCHEDULER_INTERVAL_MS || '300000', 10);
      const tenantLimit = parseInt(processRef.env.MARKETING_GOOGLE_ADS_SCHEDULER_TENANT_LIMIT || '50', 10);
      const autoUploadOnScheduler = processRef.env.MARKETING_GOOGLE_ADS_AUTO_UPLOAD_ON_SCHEDULER !== 'false';
      startMarketingGoogleAdsScheduler({ intervalMs, tenantLimit, autoUploadOnScheduler });
    } catch (err) {
      logger.warn('[MarketingGoogleAdsScheduler] Falha ao iniciar (ignorado)', { error: err.message });
    }
  }

  // Bug Loop Worker (laço autônomo de bugs do Engineering Router) - best-effort.
  // Sem ele, um finding criado pelo hook de falha da missão só seria processado por chamada manual.
  //
  // NÃO É "IGNORADO SE FALHAR". O restante do RAP continua tolerante (o processo não cai), mas o
  // subsistema de ENGENHARIA passa a se declarar DEGRADED/NO_GO quando este worker — que é
  // OBRIGATÓRIO para ele — não sobe. Antes, uma falha aqui virava um `logger.warn` e a plataforma
  // exibia saúde normal sem a capacidade que processa findings: um silêncio que esconde indisponível.
  if (processRef.env.ENABLE_BUG_LOOP_WORKER !== 'false') {
    const { startBugLoopWorker, getBugLoopWorkerStatus } = require('../services/engineeringMission/bugLoopWorker');
    try {
      const bugLoopIntervalMs = parseInt(processRef.env.ENGINEERING_BUG_LOOP_INTERVAL_MS || '15000', 10);
      const bugLoopBatch = parseInt(processRef.env.ENGINEERING_BUG_LOOP_BATCH || '10', 10);
      const startResult = startBugLoopWorker({ intervalMs: bugLoopIntervalMs, limit: bugLoopBatch });
      if (startResult && startResult.started === false && startResult.reason === 'start_failed') {
        logger.error('[bugLoopWorker] worker OBRIGATÓRIO do subsistema de engenharia NÃO iniciou — engenharia marcada como DOWN', {
          error: startResult.error,
        });
      }
    } catch (err) {
      // Exceção NÃO tratada dentro do próprio start é o mesmo caso: o worker não está no ar. O erro
      // é registrado no módulo (estado DOWN) e aqui em nível de erro, nunca como aviso silencioso.
      logger.error('[bugLoopWorker] worker OBRIGATÓRIO do subsistema de engenharia FALHOU ao iniciar', {
        error: err.message, code: err.code || null,
      });
      // Garante que o estado DOWN fique registrado mesmo quando a exceção escapou do worker.
      try {
        const status = getBugLoopWorkerStatus();
        if (status.health !== 'DOWN') {
          logger.warn('[bugLoopWorker] estado após falha de start', { health: status.health, code: status.code });
        }
      } catch (_) { /* diagnóstico best-effort */ }
    }
  }
}

/**
 * SAÚDE DO SUBSISTEMA DE ENGENHARIA — exposta para health/observability.
 *
 * Regra: com o Engineer Router ATIVO, o worker do laço de bugs é OBRIGATÓRIO. Se ele estiver DOWN, a
 * engenharia é NO_GO; DEGRADED/STOPPED, DEGRADED. A tolerância do resto do RAP permanece — o que
 * muda é que a capacidade ausente deixa de ser invisível.
 *
 * Classificação DEVELOPMENT: este é diagnóstico de engenharia, não superfície de cliente.
 */
function getEngineeringWorkerHealth({ engineerRouterEnabled = null } = {}) {
  const { assessEngineeringReadiness } = require('../../engine/engineeringMission/workerHealth');
  const enabled = engineerRouterEnabled === null
    ? process.env.ENABLE_BUG_LOOP_WORKER !== 'false'
    : Boolean(engineerRouterEnabled);

  let worker = null;
  try {
    worker = require('../services/engineeringMission/bugLoopWorker').getBugLoopWorkerStatus();
  } catch (err) {
    worker = {
      type: 'BUG_LOOP', health: 'DOWN', state: 'DOWN', healthy: false,
      code: 'WORKER_NOT_LOADABLE', reason: `não foi possível carregar o worker: ${err.message}`,
    };
  }

  const readiness = assessEngineeringReadiness({ requiredWorkers: [worker], engineerRouterEnabled: enabled });
  return {
    engineeringReadiness: readiness.readiness,
    code: readiness.code,
    reason: readiness.reason,
    blocking: readiness.blocking,
    degraded: readiness.degraded,
    workers: { bugLoop: worker },
  };
}

/**
 * Para todos os workers iniciados por startWorkers (best-effort).
 * Usado pelo shutdown gracioso (registerShutdownHooks).
 */
function stopWorkers() {
  if (ticketCleanupIntervalId) {
    clearInterval(ticketCleanupIntervalId);
    ticketCleanupIntervalId = null;
  }

  try {
    if (outboundWorkerRef && typeof outboundWorkerRef.stop === 'function') {
      outboundWorkerRef.stop();
    }
  } catch (_) {}

  const stopFns = [
    () => require('../services/handoverService').stopAutoReturnToBot(),
    () => require('../services/assignmentService').stopAssignmentWorker(),
    () => require('../services/executionQueueService').stopExecutionQueueWorker(),
    () => require('../services/schedulerService').stopScheduler(),
    () => require('../services/vertical/verticalSchedulerService').stopVerticalScheduler(),
    () => require('../services/channelHealthService').stopChannelHealthMonitor(),
    () => require('../services/marketing/googleAdsRecommendationSchedulerService').stopMarketingGoogleAdsScheduler(),
    () => require('../services/engineeringMission/bugLoopWorker').stopBugLoopWorker(),
  ];

  for (const stopFn of stopFns) {
    try {
      stopFn();
    } catch (_) {
      // Shutdown é best-effort: nunca falhar por um worker.
    }
  }
}

module.exports = {
  startWorkers,
  stopWorkers,
  getEngineeringWorkerHealth,
};
