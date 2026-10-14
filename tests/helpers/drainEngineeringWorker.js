'use strict';

/**
 * Drena o worker autônomo ANTES de fechar o banco de dados no teardown.
 *
 * DEFEITO MEDIDO (2026-10-14, lote 11 do selo V2, `governanceApprovalFullWorkerE2E`):
 *
 *   ● Test suite failed to run
 *     ConnectionManager.getConnection was called after the connection manager was closed!
 *     > 739 | async function listVersions(missionId) {
 *
 * O `afterAll` chamava `stopBugLoopWorker()` — que apenas faz `clearInterval` — e em
 * seguida, poucas linhas depois, `sequelize.close()`. Um ciclo que JÁ ESTAVA em
 * execução continuava rodando (o worker consulta o banco em `listVersions` etc.),
 * encontrava a conexão fechada e produzia **rejeição não tratada**. O Jest então
 * marcava a suíte como `failed` com **0 testes falhados**, e o lote terminava com
 * `exit=1`: exatamente o `BATCH_EXIT_CODE_NONZERO :: reconheça a causa (drenagem,
 * timeout, crash)`. Como o runner trata isso como violação de propósito (sem lista
 * de exceções), o selo era abortado em `SUITE_EXECUTION`.
 *
 * Por que passava ISOLADA e falhava no LOTE: é corrida de tempo. Sozinha, o ciclo
 * termina antes do `close()`; sob a cadência do lote, não.
 *
 * `stopBugLoopWorker()` NÃO é "aguarde o worker parar", é "pare de agendar novos
 * ciclos". Quem fecha recurso compartilhado (aqui, o Sequelize) precisa esperar o
 * ciclo em curso terminar — que é o que este helper faz, fail-closed: se não drenar
 * dentro do orçamento, o erro é EXPLÍCITO em vez de virar falha de suíte fantasma.
 *
 * Uso (no `afterAll`, antes de `sequelizeModule.close()`):
 *
 *   const { stopWorkerAndDrain } = require('../helpers/drainEngineeringWorker');
 *   ...
 *   await stopWorkerAndDrain();
 *   await sequelizeModule.close().catch(() => {});
 */

const WORKER_PATH = '../../api/services/engineeringMission/bugLoopWorker';

/**
 * @param {{timeoutMs?: number, pollMs?: number, worker?: object}} [options]
 * @returns {Promise<{stopped: object, waitedMs: number, cycles: number}>}
 */
async function stopWorkerAndDrain({ timeoutMs = 120000, pollMs = 100, worker } = {}) {
  const bugLoopWorker = worker || require(WORKER_PATH);
  const resultado = bugLoopWorker.stopBugLoopWorker();

  const inicio = Date.now();
  for (;;) {
    const status = bugLoopWorker.getBugLoopWorkerStatus() || {};
    if (!status.cycleRunning) {
      return { stopped: resultado, waitedMs: Date.now() - inicio, cycles: status.cycles || 0 };
    }
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `worker nao drenou em ${timeoutMs}ms (cycleRunning continua true): o ciclo em curso nao ` +
          'terminou. Fechar o banco agora produziria "getConnection after close" como falha de ' +
          'SUITE fantasma (0 testes falhados, exit != 0). Investigue o ciclo preso; nao aumente ' +
          'o orcamento sem entender a causa.'
      );
    }
    await new Promise((resolve) => { setTimeout(resolve, pollMs); });
  }
}

module.exports = { stopWorkerAndDrain };
