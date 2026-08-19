'use strict';

function startServerRuntime({
  logger,
  clearLimitersCache,
  startInitialization,
  getOrCreateServer,
  port,
  startWorkers,
  workerDeps,
  processRef = process,
}) {
  clearLimitersCache();

  logger.info('[Server] Iniciando servidor...');
  logger.info('[Server] Aguardando inicialização do runtime...');

  return startInitialization()
    .then(async () => {
      const server = getOrCreateServer();

      // MCP HTTP boundary (/mcp) é montado em api/app/registerRoutes.js,
      // antes do fallback terminal 404 — não remontar aqui.

      // P1: MCP Client composition — registra tools externas no Tool Registry.
      try {
        const { startMcpClientComposition } = require('./startMcpClient');
        await startMcpClientComposition();
      } catch (err) {
        logger.warn('[Server] MCP Client composition falhou (não-bloqueante)', { error: err.message });
      }

      logger.info('[Server] ✅ Inicialização concluída, iniciando servidor...');
      server.listen(port, () => {
        logger.info(`API server listening on http://0.0.0.0:${port}`);
      });

      startWorkers(workerDeps);
      return server;
    })
    .catch((error) => {
      logger.error('[Server] ❌ Erro crítico ao inicializar runtime');
      logger.error('[Server] Erro:', error);
      logger.error('[Server] Stack:', error.stack);
      processRef.exit(1);
      return null;
    });
}

module.exports = {
  startServerRuntime,
};
