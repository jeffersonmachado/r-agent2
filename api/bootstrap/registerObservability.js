'use strict';

function createObservabilityRegistrar({
  logger,
  saveSessionEventsToFileImmediate,
  shutdownServer,
}) {
  let processHandlersRegistered = false;

  function registerProcessHandlers() {
    if (processHandlersRegistered) return;
    processHandlersRegistered = true;

    const handleSignal = (signalName) => {
      logger.info(`[Conversations] Encerrando servidor por ${signalName}, salvando conversas...`);
      shutdownServer({ closeHttpServer: true })
        .then(() => process.exit(0))
        .catch((err) => {
          logger.error('[Server] Falha ao encerrar serviços', err);
          process.exit(1);
        });
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('beforeExit', () => {
      saveSessionEventsToFileImmediate();
    });
  }

  return {
    registerProcessHandlers,
  };
}

module.exports = {
  createObservabilityRegistrar,
};
