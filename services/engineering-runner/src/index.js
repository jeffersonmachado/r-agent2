'use strict';

/**
 * Entry point do Engineering Runner (ER-V1-SEAL-003).
 *
 * DEVELOPMENT ONLY: nunca deve ser exposto ao Workspace, ao cliente, ou aparecer em qualquer
 * menu de produção — é infraestrutura interna de suporte ao Engineering Model Router V1, o
 * único processo autorizado a ter acesso ao Docker socket do host.
 *
 * Sobe o servidor HTTP com:
 *  - config via env, fail-closed (sem ENGINEERING_RUNNER_TOKEN → não sobe);
 *  - shutdown gracioso: SIGTERM/SIGINT → para de aceitar conexões, drena e sai.
 *
 * Exporta `createService` para testes; `main` só executa quando rodado diretamente.
 */

const { loadConfig } = require('./config');
const { createHttpServer } = require('./httpServer');

function createService({ env, configOverrides, logger = console } = {}) {
  const config = loadConfig(env, configOverrides);
  const http = createHttpServer({ config, logger });
  return Object.freeze({ config, http });
}

async function main() {
  const service = createService({});
  const { http, config } = service;
  await http.start();

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[engineering-runner] shutdown iniciado (${signal})`);
    try {
      await http.stop();
      console.log('[engineering-runner] shutdown concluído');
      process.exit(0);
    } catch (error) {
      console.error('[engineering-runner] shutdown com falha', error.message);
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });

  console.log(`[engineering-runner] serviço pronto na porta ${config.port} (DEVELOPMENT ONLY)`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`engineering-runner fatal: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { createService, main };
