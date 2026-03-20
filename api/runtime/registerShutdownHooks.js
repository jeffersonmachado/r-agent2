'use strict';

function registerShutdownHooks({ logger, outboundWorker, saveSessionEventsToFileImmediate, processRef = process }) {
  const stopOutboundWorker = () => {
    try {
      if (outboundWorker && typeof outboundWorker.stop === 'function') {
        outboundWorker.stop();
      }
    } catch (_) {
      // Keep shutdown best-effort semantics.
    }
  };

  processRef.on('SIGINT', () => {
    logger.info('[Conversations] Encerrando servidor, salvando conversas...');
    stopOutboundWorker();
    saveSessionEventsToFileImmediate();
    processRef.exit(0);
  });

  processRef.on('SIGTERM', () => {
    logger.info('[Conversations] Encerrando servidor, salvando conversas...');
    stopOutboundWorker();
    saveSessionEventsToFileImmediate();
    processRef.exit(0);
  });

  processRef.on('beforeExit', () => {
    saveSessionEventsToFileImmediate();
  });
}

module.exports = {
  registerShutdownHooks,
};
