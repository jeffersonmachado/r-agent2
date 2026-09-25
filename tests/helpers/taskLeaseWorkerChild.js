'use strict';

/**
 * Worker A do E2E de REAL TASK RECOVERY (missão V2).
 *
 * Executa como PROCESSO SEPARADO, adquire o lease da EngineeringTask REAL, coloca-a em IMPLEMENTING
 * e permanece vivo segurando o lease até ser morto por SIGKILL -9. Sem handler de sinal: a morte tem
 * de ser abrupta, sem liberar lease nem terminar a fase — é o cenário que a missão exige.
 *
 * Handshake: imprime UMA linha JSON {"state":"READY",...} quando o lease da task está adquirido.
 */

const taskId = process.argv[2];
if (!taskId) {
  console.error('taskLeaseWorkerChild: taskId é obrigatório');
  process.exit(2);
}
const workerInstanceId = process.argv[3] || 'task-worker-A';
// O modelo EngineeringTask NÃO tem `mission_id`: o vínculo vive na MISSÃO (`linked_task_id`).
// Por isso o missionId vem por argumento — descoberto ao medir que `task.missionId` era undefined e a
// missão nunca chegava a EXECUTING.
const missionId = process.argv[4] || null;

async function main() {
  const sequelizeModule = require('../../api/db/sequelize');
  const taskService = require('../../api/services/engineeringRouter/engineeringTaskService');
  const missionStore = require('../../api/services/engineeringMission/missionStoreService');

  await sequelizeModule.connect(2, 250);

  const acquired = await taskService.acquireTaskLease(taskId, { workerInstanceId, host: 'jest-task-host' });
  if (!acquired.acquired) {
    process.stdout.write(`${JSON.stringify({ state: 'TASK_LEASE_NOT_ACQUIRED', reason: acquired.reason })}\n`);
    process.exit(3);
  }

  // Fase material em execução, sob o lease deste processo (via CAS).
  // Estado CORRETO do sistema: `CODING` — a máquina de estados (engine/engineeringRouter/stateMachine.js)
  // não possui `IMPLEMENTING`. Usar o vocabulário do prompt em vez do vocabulário do sistema deixava a
  // task num estado inválido e TODA transição a partir dele era rejeitada (IMPLEMENTING -> RED).
  await taskService.updateTaskGuarded(taskId, { status: 'CODING' }, {
    leaseToken: acquired.lease.token,
    fence: acquired.lease.fence,
  });

  // A missão dona da task fica EXECUTING — é o estado em que o recovery precisa encontrá-la.
  if (missionId) {
    await missionStore.updateMission(missionId, { status: 'EXECUTING' });
  }

  process.stdout.write(`${JSON.stringify({
    state: 'READY',
    pid: process.pid,
    workerInstanceId,
    taskLeaseToken: acquired.lease.token,
    taskFence: acquired.lease.fence,
    missionId,
  })}\n`);

  setInterval(() => {}, 1000);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ state: 'CHILD_ERROR', code: error.code || null, message: error.message })}\n`);
  process.exit(1);
});
