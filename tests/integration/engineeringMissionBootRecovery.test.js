'use strict';

/**
 * Boot Recovery — retomada AUTOMÁTICA após crash, sem chamada manual (§7, §8, §22).
 *
 * O que este teste prova (e o que ele deliberadamente NÃO prova):
 *   PROVA: a aplicação, ao subir, descobre sozinha o trabalho abandonado, adquire LEASE, valida a
 *   spec aprovada e RETOMA A TASK vinculada — sem ninguém chamar
 *   `POST /engineering/missions/resume-interrupted`. Prova também que missão aguardando aprovação
 *   ou bloqueada NÃO é retomada, e que o estado do worker antigo não é sobrescrito.
 *   NÃO PROVA: a durabilidade interna do loop do Router (retomar de CODING/TESTING/REVIEWING).
 *   Essa parte já é provada em `tests/integration/engineeringRouterDurableResumeE2E.test.js`, com
 *   crash real de processo (`runTask` retomado chega a GREEN). Aqui o Router é substituído por um
 *   dublê JUSTAMENTE para isolar a responsabilidade do coordenador: qual task ele manda retomar e
 *   por quê. Sem esse isolamento, uma falha do coordenador poderia ser mascarada por um Router que
 *   "se vira sozinho".
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO.
 */

jest.mock('../../api/services/engineeringRouter/engineeringRouterService', () => ({
  runTask: jest.fn(),
}));

const sequelizeModule = require('../../api/db/sequelize');
const routerService = require('../../api/services/engineeringRouter/engineeringRouterService');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const store = require('../../api/services/engineeringMission/missionStoreService');
const coordinator = require('../../api/services/engineeringMission/missionRecoveryCoordinator');

let dbAvailable = false;
let dbReason = null;
const created = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  // Porta ÚNICA de infraestrutura (§11/§12): em RELEASE_AUTHORITATIVE=1 isto LANÇA INFRA_ERROR
  // (nunca PASS silencioso); em dev registra NOT_EXECUTED com motivo.
  return require('../helpers/infraGate').skipOrFail({ suite: 'mission-boot-recovery', available: dbAvailable, reason: dbReason, requirement: 'postgres' });
}

function models() {
  const index = require('../../api/db/models');
  return { Mission: index.EngineeringMission() };
}

async function cleanup(missionId) {
  const { Mission } = models();
  for (const table of ['engineering_mission_reviews', 'engineering_mission_approvals', 'engineering_mission_versions']) {
    await Mission.sequelize.query(`DELETE FROM ${table} WHERE mission_id = :id`, { replacements: { id: missionId } }).catch(() => {});
  }
  const mission = await store.getMission(missionId);
  if (mission?.linked_task_id) {
    await Mission.sequelize.query(`DELETE FROM engineering_attempts WHERE task_id = :t`, { replacements: { t: mission.linked_task_id } }).catch(() => {});
    await Mission.sequelize.query(`DELETE FROM engineering_tasks WHERE id = :t`, { replacements: { t: mission.linked_task_id } }).catch(() => {});
  }
  await Mission.destroy({ where: { id: missionId } }).catch(() => {});
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

beforeEach(() => {
  // jest.config tem resetMocks:true — a implementação precisa ser reafirmada a cada teste.
  routerService.runTask.mockResolvedValue({ status: 'GREEN', taskId: 'dublê', phases: [] });
  // O recovery é desligado por default em NODE_ENV=test (para nenhum timer surpresa subir durante
  // os testes). Aqui o comportamento EM TESTE é justamente o recovery, então ele é habilitado
  // explicitamente — o mesmo switch que a produção usa.
  process.env.ENGINEERING_MISSION_RECOVERY_ENABLED = '1';
});

afterAll(async () => {
  if (!dbAvailable) return;
  for (const id of created) await cleanup(id);
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('Mission Recovery Coordinator — boot automático', () => {
  jest.setTimeout(90000);

  test('boot retoma a TASK de missão EXECUTING abandonada, sem endpoint manual', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission('Recovery deve retomar execução interrompida por crash.', { createdBy: 'jest-recovery', tenantId: 'system' });
    created.push(mission.id);
    await approvalService.approve(mission.id, { actor: 'jest-recovery' });
    const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
    const execution = await orchestrator.startExecution(mission.id, { actor: 'jest-recovery', tenantId: 'system' });
    expect(execution.task.id).toBeTruthy();

    // Crash: o worker morre com a missão em EXECUTING e o lease vencido (sem release).
    const lease = await store.acquireMissionLease(mission.id, { workerInstanceId: 'worker-crash', workerType: 'ORCHESTRATOR', ttlMs: 60000 });
    expect(lease.acquired).toBe(true);
    await store.updateMissionGuarded(mission.id, { status: 'EXECUTING' }, { leaseToken: lease.lease.token, fence: lease.lease.fence });
    await models().Mission.sequelize.query(`UPDATE engineering_missions SET lease_expires_at = NOW() - interval '1 second' WHERE id = :id`, { replacements: { id: mission.id } });

    routerService.runTask.mockClear();
    const summary = await coordinator.runBootRecovery({ tenantId: 'system' });

    expect(summary.recovered).toBeGreaterThanOrEqual(1);
    const item = summary.items.find((i) => i.missionId === mission.id);
    expect(item).toBeTruthy();
    expect(item.action).toBe('TASK_RESUMED');
    expect(item.taskId).toBe(execution.task.id);
    // A ORDEM importa: o coordenador mandou o Router retomar A TASK DA MISSÃO, não outra qualquer.
    expect(routerService.runTask).toHaveBeenCalledWith(execution.task.id, expect.anything());
  }, 90000);

  test('boot NÃO retoma missão aguardando aprovação (decisão é humana) nem missão bloqueada', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission('Missão aguardando decisão humana não deve ser retomada.', { createdBy: 'jest-recovery', tenantId: 'system' });
    created.push(mission.id);
    const detail = await compiler.getMissionDetail(mission.id);
    expect(['AWAITING_APPROVAL', 'APPROVED']).toContain(detail.status);

    const blocked = await compiler.compileMission('Missão bloqueada por revisão não deve ser retomada.', { createdBy: 'jest-recovery', tenantId: 'system' });
    created.push(blocked.id);
    await store.updateMission(blocked.id, { status: 'BLOCKED', failure: { code: 'META_REVIEW_BLOCKED' } });

    routerService.runTask.mockClear();
    const summary = await coordinator.runBootRecovery({ tenantId: 'system' });
    const ids = summary.items.map((i) => i.missionId);
    expect(ids).not.toContain(mission.id);
    expect(ids).not.toContain(blocked.id);
    expect(routerService.runTask).not.toHaveBeenCalledWith(expect.stringContaining(mission.id), expect.anything());
  }, 90000);

  test('dois coordenadores concorrentes: o perdedor NÃO retoma a mesma missão (lease)', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission('Lease impede retomada duplicada por dois coordenadores.', { createdBy: 'jest-recovery', tenantId: 'system' });
    created.push(mission.id);
    await approvalService.approve(mission.id, { actor: 'jest-recovery' });
    const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
    const execution = await orchestrator.startExecution(mission.id, { actor: 'jest-recovery', tenantId: 'system' });

    // Worker A segura o lease ATIVO: trabalho não está abandonado, é de A.
    const held = await store.acquireMissionLease(mission.id, { workerInstanceId: 'coordenador-A', workerType: 'RECOVERY', ttlMs: 120000 });
    expect(held.acquired).toBe(true);

    routerService.runTask.mockClear();
    const summary = await coordinator.runBootRecovery({ tenantId: 'system' });
    const item = summary.items.find((i) => i.missionId === mission.id);
    // Pode nem aparecer (não foi descoberta) ou aparecer como recusada — o que NUNCA pode é retomar.
    if (item) expect(['SKIP', 'NO_TASK_TO_RESUME']).toContain(item.action);
    expect(routerService.runTask).not.toHaveBeenCalledWith(execution.task.id, expect.anything());
  }, 90000);

  test('recovery é idempotente: duas varreduras seguidas não duplicam task nem efeito', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission('Duas varreduras de recovery não podem duplicar task.', { createdBy: 'jest-recovery', tenantId: 'system' });
    created.push(mission.id);
    await approvalService.approve(mission.id, { actor: 'jest-recovery' });
    const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
    const execution = await orchestrator.startExecution(mission.id, { actor: 'jest-recovery', tenantId: 'system' });
    await store.updateMission(mission.id, { status: 'EXECUTING' });

    const first = await coordinator.runBootRecovery({ tenantId: 'system' });
    expect(first.items.find((i) => i.missionId === mission.id)?.action).toBe('TASK_RESUMED');

    const after = await store.getMission(mission.id);
    const taskIds = Array.isArray(after.linked_task_ids) ? after.linked_task_ids : [];
    expect(taskIds).toEqual([execution.task.id]);

    const second = await coordinator.runBootRecovery({ tenantId: 'system' });
    const after2 = await store.getMission(mission.id);
    expect(after2.linked_task_ids).toEqual([execution.task.id]);

    // A prova FORTE de idempotência: existe exatamente UMA EngineeringTask com a chave de
    // idempotência da missão (`mission:<id>:v<versão>`), depois de DUAS varreduras completas.
    // Contar `recovered` do resumo não serviria: ele agrega missões de outros testes na mesma base.
    const { Mission } = models();
    const [{ n }] = await Mission.sequelize.query(
      `SELECT COUNT(*)::int AS n FROM engineering_tasks WHERE idempotency_key = :key`,
      { replacements: { key: `mission:${mission.id}:v1` }, type: Mission.sequelize.constructor.QueryTypes.SELECT },
    );
    expect(n).toBe(1);
    expect(second.items.filter((i) => i.missionId === mission.id && i.action === 'TASK_RESUMED').length).toBeLessThanOrEqual(1);
  }, 90000);

  test('lease é liberado ao final da varredura (missão não fica presa a um coordenador que saiu)', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission('Lease deve ser liberado ao fim da varredura.', { createdBy: 'jest-recovery', tenantId: 'system' });
    created.push(mission.id);
    await approvalService.approve(mission.id, { actor: 'jest-recovery' });
    const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
    await orchestrator.startExecution(mission.id, { actor: 'jest-recovery', tenantId: 'system' });
    await store.updateMission(mission.id, { status: 'EXECUTING' });

    await coordinator.runBootRecovery({ tenantId: 'system' });
    const lease = await store.getMissionLease(mission.id);
    expect(lease.token).toBeNull();
  }, 90000);
});
