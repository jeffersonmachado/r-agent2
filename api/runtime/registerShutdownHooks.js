'use strict';

function registerShutdownHooks({
  logger,
  outboundWorker,
  saveSessionEventsToFileImmediate,
  stopWorkers,
  getServer,
  forceExitTimeoutMs = 10000,
  processRef = process,
}) {
  const logWarn = (message) => {
    if (logger && typeof logger.warn === 'function') logger.warn(message);
    else if (logger && typeof logger.info === 'function') logger.info(message);
  };

  const stopOutboundWorker = () => {
    try {
      if (outboundWorker && typeof outboundWorker.stop === 'function') {
        outboundWorker.stop();
      }
    } catch (_) {
      // Keep shutdown best-effort semantics.
    }
  };

  const stopAllWorkers = () => {
    stopOutboundWorker();
    try {
      if (typeof stopWorkers === 'function') {
        stopWorkers();
      }
    } catch (_) {
      // Keep shutdown best-effort semantics.
    }
  };

  const shutdown = () => {
    logger.info('[Conversations] Encerrando servidor, salvando conversas...');
    stopAllWorkers();
    saveSessionEventsToFileImmediate();

    const server = typeof getServer === 'function' ? getServer() : null;
    if (!server || typeof server.close !== 'function') {
      processRef.exit(0);
      return;
    }

    // Timeout de segurança: força o exit para não pendurar deploy se houver
    // conexões abertas segurando o server.close().
    const forceTimer = setTimeout(() => {
      logWarn('[Conversations] Timeout no encerramento gracioso; forçando exit');
      processRef.exit(1);
    }, forceExitTimeoutMs);
    if (typeof forceTimer.unref === 'function') {
      forceTimer.unref();
    }

    server.close(() => {
      clearTimeout(forceTimer);
      processRef.exit(0);
    });
  };

  processRef.on('SIGINT', shutdown);

  processRef.on('SIGTERM', shutdown);

  processRef.on('beforeExit', () => {
    saveSessionEventsToFileImmediate();
  });
}

module.exports = {
  registerShutdownHooks,
};
