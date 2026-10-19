'use strict';

/**
 * Worker A do E2E de REAL TASK RECOVERY (missão V2).
 *
 * Executa como PROCESSO SEPARADO, dispara o CAMINHO REAL do Router (`runTask`: roteia, PERSISTE a
 * decisão de roteamento e entra na fase material sob lease com heartbeat) e permanece vivo segurando
 * o lease até ser morto por SIGKILL -9. Sem handler de sinal: a morte tem de ser abrupta, sem
 * liberar lease nem terminar a fase — é o cenário que a missão exige.
 *
 * DEFEITO CORRIGIDO (2026-09-28, medido): a versão anterior adquiria o lease e FORÇAVA
 * `status=CODING` diretamente, pulando o roteamento. A evidência era FALSA: `routing_decision` ficava
 * `{}`, e a execução retomada não podia continuar — falhava com `NO_QUALIFIED_CODER`, que parecia
 * defeito do produto e era defeito do HARNESS (ele pulava a etapa que a execução real sempre
 * executa). Prova de retomada que não passa pelo caminho real não prova a retomada do produto.
 *
 * Handshake: imprime UMA linha JSON {"state":"READY",...} quando a task entra na fase MATERIAL
 * (CODING) JÁ sob o caminho real. Se a fase material não acontecer, o handshake é explícito
 * (`state: "MATERIAL_PHASE_NOT_REACHED"`) — nunca silêncio.
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

const MATERIAL_PHASE = 'CODING';
const MATERIAL_TIMEOUT_MS = Number(process.env.TASK_LEASE_WORKER_MATERIAL_TIMEOUT_MS || 60000);
const TERMINAL_STATES = ['RED', 'CANCELLED', 'COMPLETED', 'PROMOTED', 'READY_FOR_PROMOTION'];

const { formatHandshakeLine } = require('../../scripts/governance/lib/task-lease-handshake');

/**
 * Handshake do lease da TASK — MARCADO de forma inequívoca.
 * O produto LOGa JSON no mesmo stdout; sem marcador, um log com `state` era
 * adotado como handshake pelo harness (defeito medido em 2026-10-16).
 */
function emitHandshake(payload) {
  process.stdout.write(formatHandshakeLine(payload));
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/** Espera a task entrar na fase MATERIAL pelo caminho real (ou encerrar antes disso). */
async function waitForMaterialPhase(taskService, deadlineMs) {
  const startedAt = Date.now();
  for (;;) {
    const task = await taskService.getTask(taskId).catch(() => null);
    if (task && (task.status === MATERIAL_PHASE || TERMINAL_STATES.includes(task.status))) return task;
    if (Date.now() - startedAt > deadlineMs) return task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main() {
  const sequelizeModule = require('../../api/db/sequelize');
  const taskService = require('../../api/services/engineeringRouter/engineeringTaskService');
  const missionStore = require('../../api/services/engineeringMission/missionStoreService');
  const { runTask } = require('../../api/services/engineeringRouter/engineeringRouterService');

  await sequelizeModule.connect(2, 250);

  // A missão dona da task fica EXECUTING — é o estado em que o recovery precisa encontrá-la.
  if (missionId) {
    await missionStore.updateMission(missionId, { status: 'EXECUTING' });
  }

  // CAMINHO REAL: `runTask` adquire o lease, ROTEIA (e persiste a decisão) e faz a fase material.
  // A promessa roda em background; este processo segue vivo segurando o lease (heartbeat ativo).
  let runFailure = null;
  const running = runTask(taskId, { runnerId: workerInstanceId })
    .catch((error) => { runFailure = { code: error.code || null, message: error.message }; return null; });

  const task = await waitForMaterialPhase(taskService, MATERIAL_TIMEOUT_MS);

  if (!task || task.status !== MATERIAL_PHASE) {
    emit({
      state: 'MATERIAL_PHASE_NOT_REACHED',
      status: task ? task.status : null,
      lastError: task ? task.last_error || null : null,
      runFailure,
    });
    process.exit(4);
  }

  const lease = await taskService.getTaskLease(taskId);

  emitHandshake({
    state: 'READY',
    pid: process.pid,
    workerInstanceId,
    taskLeaseToken: lease ? lease.token : null,
    taskFence: lease ? lease.fence : null,
    missionId,
    materialPhase: MATERIAL_PHASE,
    routingDecisionPersisted: Boolean(task.routing_decision && task.routing_decision.coder),
  });

  setInterval(() => {}, 1000);
  void running;
}

main().catch((error) => {
  emit({ state: 'CHILD_ERROR', code: error.code || null, message: error.message });
  process.exit(1);
});
