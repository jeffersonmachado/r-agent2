'use strict';

/**
 * Processo A do E2E de crash real (§9, §40).
 *
 * Este arquivo é executado como PROCESSO SEPARADO e precisa ser morto por `SIGKILL -9`, sem chance
 * de rodar cleanup. Ele NÃO instala handler de sinal de propósito: qualquer `SIGTERM` tratado
 * tornaria a prova mentirosa (o lease seria liberado, e não haveria nada para recuperar).
 *
 * Handshake: imprime UMA linha JSON `{"state":"READY",...}` no stdout quando o lease está
 * adquirido e a missão está em execução. O pai só então mata o processo.
 */

const missionId = process.argv[2];
if (!missionId) {
  console.error('crashWorkerChild: missionId é obrigatório');
  process.exit(2);
}

const workerInstanceId = process.argv[3] || 'crash-worker-A';

async function main() {
  const sequelizeModule = require('../../api/db/sequelize');
  const store = require('../../api/services/engineeringMission/missionStoreService');

  await sequelizeModule.connect(2, 250);

  const acquired = await store.acquireMissionLease(missionId, {
    workerInstanceId,
    workerType: 'ORCHESTRATOR',
    host: 'jest-crash-host',
  });
  if (!acquired.acquired) {
    process.stdout.write(`${JSON.stringify({ state: 'LEASE_NOT_ACQUIRED', reason: acquired.reason })}\n`);
    process.exit(3);
  }

  // Trabalho real em andamento: a missão fica EXECUTING sob o lease deste processo.
  //
  // Observação de runtime: `updateMissionGuarded` dispara a cadeia de eventos da missão
  // (missionEvents → WebSocket). Num worker de vida curta isso segura o processo antes do
  // handshake — o lease ficava adquirido e o pai nunca recebia o READY. Aqui a transição de estado
  // é feita por SQL direto para que o HANDSHAKE seja determinístico; o que precisa ser provado pelo
  // caminho oficial (aquisição de lease, token e fencing) continua pelo caminho oficial.
  const model = require('../../api/db/models').EngineeringMission();
  await model.sequelize.query(`UPDATE engineering_missions SET status = 'EXECUTING' WHERE id = :id`, {
    replacements: { id: missionId },
  });

  process.stdout.write(`${JSON.stringify({
    state: 'READY',
    pid: process.pid,
    workerInstanceId,
    token: acquired.lease.token,
    fence: acquired.lease.fence,
  })}\n`);

  // Vivo até ser morto. Nenhum handler de sinal: SIGKILL não é capturável de qualquer forma, e a
  // ausência de SIGTERM tratado garante que nada é liberado no caminho.
  setInterval(() => {}, 1000);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ state: 'CHILD_ERROR', code: error.code || null, message: error.message })}\n`);
  process.exit(1);
});
