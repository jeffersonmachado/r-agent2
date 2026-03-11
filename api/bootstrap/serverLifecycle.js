'use strict';

function createServerLifecycle({
  createServer,
  startInitialization,
  startJobs,
  stopJobs,
  clearLimitersCache,
  logger,
  config,
  apiVersionInfo,
  saveSessionEventsToFileImmediate,
  shutdownWebSocket,
}) {
  if (typeof createServer !== 'function') {
    throw new Error('createServer is required');
  }

  let serverInstance = null;
  let bootstrapPromise = null;
  let shutdownInProgress = false;

  function getActiveServer() {
    if (!serverInstance) {
      serverInstance = createServer();
    }
    return serverInstance;
  }

  async function bootstrapServer({ listen = true, port } = {}) {
    if (bootstrapPromise) return bootstrapPromise;

    bootstrapPromise = (async () => {
      clearLimitersCache();
      await startInitialization();
      await startJobs();

      let activeServer = null;

      if (listen) {
        activeServer = getActiveServer();
      }

      if (listen && !activeServer.listening) {
        await new Promise((resolve, reject) => {
          activeServer.once('error', reject);
          activeServer.listen(port, () => {
            activeServer.off('error', reject);
            console.log(`API server listening on http://0.0.0.0:${port}`);
            logger.info(`API server listening on http://0.0.0.0:${port}`);
            logger.info('[Server] Version info', {
              name: apiVersionInfo.name,
              version: apiVersionInfo.version,
              serverVersion: apiVersionInfo.serverVersion,
              packageVersion: apiVersionInfo.packageVersion,
              versionMismatch: apiVersionInfo.versionMismatch,
              baseVersion: apiVersionInfo.baseVersion,
              commit: apiVersionInfo.commit,
              build: apiVersionInfo.build,
              env: config.get('nodeEnv', 'development'),
            });
            if (apiVersionInfo.versionMismatch) {
              logger.warn('[Server] ALERTA: divergência de versão detectada', {
                serverVersion: apiVersionInfo.serverVersion,
                packageVersion: apiVersionInfo.packageVersion,
              });
            }
            resolve();
          });
        });
      }

      return activeServer;
    })().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });

    return bootstrapPromise;
  }

  async function shutdownServer({ closeHttpServer = true } = {}) {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    try {
      await stopJobs();

      try {
        await shutdownWebSocket();
      } catch (_) {}

      if (closeHttpServer && serverInstance) {
        await new Promise((resolve) => {
          try {
            serverInstance.closeAllConnections?.();
          } catch (_) {}

          try {
            if (!serverInstance.listening) {
              resolve();
              return;
            }
            serverInstance.close(() => resolve());
          } catch (_) {
            resolve();
          }
        });
      }

      saveSessionEventsToFileImmediate();
    } finally {
      shutdownInProgress = false;
      bootstrapPromise = null;
    }
  }

  return {
    getActiveServer,
    bootstrapServer,
    shutdownServer,
    getServerInstance: () => serverInstance,
  };
}

module.exports = {
  createServerLifecycle,
};
