/**
 * Outbound Worker (wrapper compatível).
 *
 * Observação:
 * - A fila/worker "core" já existe em outboundQueueService (processDue/startWorker/stopWorker).
 * - Este módulo padroniza a interface pedida (start/stop/processPending) e facilita boot/shutdown.
 */
 
'use strict';

const logger = require('../utils/logger');
const outboundQueueService = require('./outboundQueueService');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return safeToString(err, fallback); }
}

let timer = null;
let running = false;

async function processPending({ batchSize = 25 } = {}) {
  // Mantém nome "processPending" (spec), delegando à implementação existente.
  return outboundQueueService.processDue({ limit: batchSize });
}

function start({ intervalMs = 1500, batchSize = 25 } = {}) {
  if (running) return;
  running = true;

  // Preferimos um setInterval controlado aqui para permitir stop explícito.
  timer = setInterval(() => {
    processPending({ batchSize })
      .then((result) => {
        const processed = Number(result?.processed || 0);
        const sent = Number(result?.sent || 0);
        const failed = Number(result?.failed || 0);
        const skipped = Number(result?.skipped || 0);

        // Em produção alguns painéis exibem apenas INFO; este resumo ajuda a
        // acompanhar retries sem depender de logs WARN/ERROR.
        if (processed > 0 || sent > 0 || failed > 0 || skipped > 0) {
          logger.info('[OutboundWorker] Ciclo processado', {
            processed,
            sent,
            failed,
            skipped,
            batchSize,
          });
        }
      })
      .catch((err) => {
        logger.error('[OutboundWorker] Erro ao processar fila outbound', { error: safeErrorMessage(err) });
      });
  }, intervalMs);

  if (timer && timer.unref) timer.unref();
  logger.info('[OutboundWorker] Iniciado', { intervalMs, batchSize });
}

function stop() {
  if (!running) return;
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Best-effort: também para o worker interno caso alguém o tenha iniciado diretamente.
  try { outboundQueueService.stopWorker(); } catch (_) {}
  logger.info('[OutboundWorker] Parado');
}

module.exports = {
  start,
  stop,
  processPending,
  _internal: { get running() { return running; } },
};

