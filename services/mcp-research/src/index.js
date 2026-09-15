'use strict';

/**
 * Entry point do container MCP Research.
 *
 * Sobe o servidor HTTP Streamable (MCP) com:
 *  - config via env, fail-closed (sem token → não sobe);
 *  - modo ONLINE (provider real, política de endpoint estrita) ou OFFLINE
 *    (snapshot local, zero egress);
 *  - shutdown gracioso: SIGTERM/SIGINT → para de aceitar conexões, drena e sai.
 *
 * Exporta `createService` para testes e para o gate (protocolo em-processo);
 * o `main` só executa quando rodado diretamente (`node src/index.js`).
 */

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createSnapshotStore } = require('./snapshotStore');
const { TOOL_DEFINITIONS, createToolHandlers } = require('./researchTools');
const { createMcpResearchServer } = require('./mcpServer');
const { createHttpServer } = require('./httpServer');

/**
 * Monta o serviço completo (sem abrir porta).
 *
 * @param {object} [args]
 * @param {object} [args.env]          mapa de ambiente (default process.env)
 * @param {object} [args.configOverrides] injeção de teste (mesma validação)
 * @param {object} [args.providerDeps] injeção de teste do provider ONLINE
 * @param {object} [args.logger]
 */
function createService({ env, configOverrides, providerDeps = {}, logger } = {}) {
  const config = loadConfig(env, configOverrides);
  const log = logger || createLogger({ level: env?.LOG_LEVEL || process.env.LOG_LEVEL });

  const snapshotStore = config.mode === 'OFFLINE'
    ? createSnapshotStore({ snapshotDir: config.snapshotDir, logger: log })
    : null;

  const handlers = createToolHandlers({ config, snapshotStore, providerDeps, logger: log });

  const http = createHttpServer({
    config,
    createServer: () => createMcpResearchServer({ toolDefinitions: TOOL_DEFINITIONS, handlers, logger: log }),
    readiness: () => {
      const checks = { auth: 'configured', mode: config.mode };
      if (config.mode === 'OFFLINE') {
        // Readiness REAL: o índice do snapshot precisa ser legível.
        snapshotStore.entries();
        checks.snapshot = 'readable';
      }
      return { ready: true, checks };
    },
    logger: log,
  });

  return Object.freeze({ config, logger: log, handlers, http });
}

async function main() {
  const service = createService({});
  const { http, logger: log, config } = service;
  await http.start();

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('[mcp-research] shutdown iniciado', { signal });
    try {
      await http.stop();
      log.info('[mcp-research] shutdown concluído', { signal });
      process.exit(0);
    } catch (error) {
      log.error('[mcp-research] shutdown com falha', { error: error.message });
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });

  log.info('[mcp-research] serviço pronto', { mode: config.mode, port: config.port });
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`mcp-research fatal: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { createService, main };
