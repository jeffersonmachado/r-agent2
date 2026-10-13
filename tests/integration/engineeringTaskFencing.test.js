'use strict';

/**
 * Fencing de EngineeringTask (missão V2 — cenário obrigatório de stale worker).
 *
 * GAP CONFIRMADO por inspeção antes desta implementação: `engineering_tasks` tinha apenas
 * `locked_at`/`locked_by`, decididos por TEMPO (`LOCK_STALE_MS`). A missão exige o cenário:
 *
 *   Worker A adquire (fence 10) → para de fazer heartbeat → lease expira → Worker B adquire (fence 11)
 *   → Worker A volta atrasado e tenta gravar → ESCRITA RECUSADA. A nunca sobrescreve o trabalho de B.
 *
 * Antes só existia a primitiva em EngineeringMission; aqui ela é exercitada na TASK real.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO (fail-closed em RELEASE_AUTHORITATIVE=1).
 */

const sequelizeModule = require('../../api/db/sequelize');
const taskService = require('../../api/services/engineeringRouter/engineeringTaskService');

let dbAvailable = false;
let dbReason = null;
const created = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  return require('../helpers/infraGate').skipOrFail({ suite: 'task-fencing', available: dbAvailable, reason: dbReason, requirement: 'postgres' });
}

async function newTask() {
  // Esta suíte exercita LEASE/FENCING pelo caminho DIRETO de criação (não é task de
  // missão, cujo escopo é diferido). Como o objetivo classifica como produção de
  // patch, o contrato exige escopo declarado (Fase 9) — sem ele a criação é
  // recusada com TASK_CONTRACT_INVALID e os 5 casos de fencing nem chegam a rodar
  // (medido em 2026-10-13 na suíte autoritativa de release).
  const task = await taskService.createTask({
    title: `Task de fencing ${Date.now()}`,
    objective: 'Provar fencing de EngineeringTask',
    allowedPaths: ['api/services/engineeringRouter/'],
  }, { createdBy: 'jest-task-fencing' });
  created.push(task.id);
  return task;
}

/** Aceleração de relógio DELIBERADA e declarada: o TTL é o detector real de worker morto. */
async function expireTaskLease(taskId) {
  await taskService.constructor; // no-op para manter o import explícito
  const Model = require('../../api/db/models').EngineeringTask();
  await Model.sequelize.query(`UPDATE engineering_tasks SET lease_expires_at = NOW() - interval '1 second' WHERE id = :id`, { replacements: { id: taskId } });
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
}, 20000);

afterAll(async () => {
  if (!dbAvailable) return;
  const Model = require('../../api/db/models').EngineeringTask();
  try {
    await Model.update({ status: 'CANCELLED', lease_token: null, lease_expires_at: null }, { where: { created_by: 'jest-task-fencing' } });
  } catch (error) { /* limpeza best-effort */ }
  try { await sequelizeModule.close(); } catch (error) { /* ignore */ }
}, 20000);

describe('EngineeringTask — lease distribuído e fencing', () => {
  test('WORKER_ANTIGO_RECUSADO: A adquire, lease expira, B assume e A NÃO consegue mais gravar', async () => {
    if (skipIfNoDatabase()) return;
    const task = await newTask();

    // Worker A adquire.
    const a = await taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-A', host: 'host-a' });
    expect(a.acquired).toBe(true);
    expect(a.lease.workerInstanceId).toBe('worker-A');
    const fenceA = a.lease.fence;
    expect(fenceA).toBeGreaterThanOrEqual(1);

    // Lease vivo de A bloqueia B (não é takeover silencioso).
    const blocked = await taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-B', host: 'host-b' });
    expect(blocked.acquired).toBe(false);
    expect(blocked.reason).toBe('TASK_LEASE_HELD_BY_OTHER_WORKER');

    // A para de fazer heartbeat: com o lease expirado, B assume e o FENCE AVANÇA.
    await expireTaskLease(task.id);
    const b = await taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-B', host: 'host-b' });
    expect(b.acquired).toBe(true);
    expect(b.lease.workerInstanceId).toBe('worker-B');
    expect(b.lease.fence).toBeGreaterThan(fenceA);

    // A volta atrasado e tenta gravar com o lease ANTIGO: RECUSADO. As duas recusas são legítimas e
    // equivalentes para a missão: o token não é mais do dono (TASK_LEASE_NOT_HELD) ou o fence foi
    // ultrapassado (TASK_STALE_WORKER_WRITE). O invariante é: a escrita NÃO acontece.
    let refusal = null;
    try {
      await taskService.updateTaskGuarded(task.id, { status: 'IMPLEMENTING' }, { leaseToken: a.lease.token, fence: fenceA });
    } catch (error) {
      refusal = error.code;
    }
    expect(['TASK_STALE_WORKER_WRITE', 'TASK_LEASE_NOT_HELD', 'TASK_LEASE_EXPIRED']).toContain(refusal);

    // Escrever com o token ADULTERADO mas fence correto também não passa (proteção por token).
    let forged = null;
    try {
      await taskService.updateTaskGuarded(task.id, { status: 'IMPLEMENTING' }, { leaseToken: b.lease.token, fence: fenceA });
    } catch (error) {
      forged = error.code;
    }
    expect(forged).toBeTruthy();

    const after = await taskService.getTask(task.id);
    expect(after.status).not.toBe('IMPLEMENTING');

    // B grava normalmente.
    const written = await taskService.updateTaskGuarded(task.id, { status: 'IMPLEMENTING' }, { leaseToken: b.lease.token, fence: b.lease.fence });
    expect(written.status).toBe('IMPLEMENTING');
  }, 60000);

  test('RENOVACAO_DE_LEASE_PERDIDO: renovar com token antigo falha com TASK_LEASE_LOST', async () => {
    if (skipIfNoDatabase()) return;
    const task = await newTask();
    const a = await taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-A' });
    await expireTaskLease(task.id);
    const b = await taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-B' });
    expect(b.acquired).toBe(true);

    await expect(taskService.renewTaskLease(task.id, { leaseToken: a.lease.token })).rejects.toMatchObject({ code: 'TASK_LEASE_LOST' });
    const renewed = await taskService.renewTaskLease(task.id, { leaseToken: b.lease.token });
    expect(renewed.workerInstanceId).toBe('worker-B');
  }, 60000);

  test('RELEASE_POR_TOKEN_ERRADO_NAO_LIBERA: unlock indevido é impedido', async () => {
    if (skipIfNoDatabase()) return;
    const task = await newTask();
    const a = await taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-A' });
    await taskService.releaseTaskLease(task.id, { leaseToken: '00000000-0000-0000-0000-000000000000' });
    const still = await taskService.getTaskLease(task.id);
    expect(still.workerInstanceId).toBe('worker-A');
    expect(still.token).toBe(a.lease.token);
  }, 60000);

  test('DOIS_WORKERS_CONCORRENTES: apenas UM adquire a mesma task', async () => {
    if (skipIfNoDatabase()) return;
    const task = await newTask();
    const results = await Promise.all([
      taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-1' }),
      taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-2' }),
      taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-3' }),
    ]);
    const winners = results.filter((r) => r.acquired);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => !r.acquired)).toHaveLength(2);
  }, 60000);

  test('TRANSIÇÃO_COM_LEASE_VALIDO_ATRAVESSA_CAS: o dono atual grava a fase', async () => {
    if (skipIfNoDatabase()) return;
    const task = await newTask();
    const a = await taskService.acquireTaskLease(task.id, { workerInstanceId: 'worker-A' });
    // A transição em si usa o guard (CAS) quando o lease é apresentado; aqui provamos que o dono
    // ATUAL não é bloqueado pelo fencing (o bloqueio é só para o worker ultrapassado).
    const written = await taskService.updateTaskGuarded(task.id, { status: 'IMPLEMENTING' }, { leaseToken: a.lease.token, fence: a.lease.fence });
    expect(written).toBeTruthy();
    // A posse continua com A e o fence NÃO mudou: escrita legítima não rouba o lease.
    const leaseAfter = await taskService.getTaskLease(task.id);
    expect(leaseAfter.workerInstanceId).toBe('worker-A');
    expect(leaseAfter.fence).toBe(a.lease.fence);
  }, 60000);
});
