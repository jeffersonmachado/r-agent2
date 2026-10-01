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
  // ── Isolamento de falhas de processo ──────────────────────────────────────
  // Uma promise rejeitada SEM catch dentro de cliente de terceiro derrubava a
  // API INTEIRA (Node >= 15 aborta por default). Medido em 2026-10-01, duas
  // vezes: `whatsapp-web.js/src/Client.js` (~linha 1324) faz `await res.text()`
  // DENTRO de um handler de evento `async` sem catch — quando a página CDP
  // fecha, a rejeição sobe e o processo morre. Consequência: todos os tenants
  // caem junto e o converge/mesh de ~40 min aborta no meio (o mesh do
  // release-package ficou 1h pendurado esperando a API que já não existia).
  // A API é multi-tenant e hospeda integrações OPCIONAIS: rejeição não tratada
  // é registrada com stack e o processo segue servindo. Falhar explícito é
  // diferente de morrer em silêncio.
  let unhandledRejectionCount = 0;
  processRef.on('unhandledRejection', (reason) => {
    unhandledRejectionCount += 1;
    const isError = reason instanceof Error;
    try {
      logger.error('[Server] unhandledRejection (processo mantido vivo)', {
        count: unhandledRejectionCount,
        message: isError ? reason.message : String(reason),
        stack: isError ? reason.stack : undefined,
      });
    } catch {
      // logger indisponível nunca pode derrubar o processo
    }
  });

  // Estado após exceção não capturada é indefinido: registra e encerra (mesmo
  // desfecho default do Node, porém com evidência no log).
  processRef.on('uncaughtException', (error) => {
    try {
      logger.error('[Server] uncaughtException — encerrando processo', {
        message: error && error.message,
        stack: error && error.stack,
      });
    } catch {
      // ignora falha do logger: o processo encerra de qualquer forma
    }
    processRef.exit(1);
  });

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

      // ERV1-CLOSE-009: se o processo morreu no meio de uma tentativa do Engineering Router,
      // o workspace isolado (git worktree) daquela tentativa nunca foi limpo — varre e remove
      // os órfãos reais no boot, antes de aceitar tráfego. Nunca bloqueia o boot em caso de
      // falha (repositório git indisponível, etc.).
      try {
        const { pruneOrphanedWorkspaces } = require('../services/engineeringRouter/patchApplyService');
        const { pruned } = await pruneOrphanedWorkspaces();
        if (pruned.length > 0) {
          logger.info('[Server] Engineering Router: workspaces órfãos removidos no boot', { count: pruned.length });
        }
      } catch (err) {
        logger.warn('[Server] Engineering Router: pruning de workspaces órfãos falhou (não-bloqueante)', { error: err.message });
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
