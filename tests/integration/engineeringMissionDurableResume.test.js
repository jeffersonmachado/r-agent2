'use strict';

/**
 * DURABLE EXECUTION do ciclo de missão — crash/restart em cada fase (§17, §18).
 *
 * Um crash é simulado da forma mais honesta possível: o estado que um processo morto teria DEIXADO
 * NO BANCO é replicado (status/fase intermediária, lock órfão), e então a função de retomada REAL
 * é chamada. Nenhum estado vive em memória de processo — a descoberta de missões incompletas é uma
 * query no banco.
 *
 *   TEST 43 crash durante AWAITING_APPROVAL preserva estado
 *   TEST 44 crash após approval não perde aprovação
 *   §17  crash durante ENRICHMENT → retoma sem duplicar versão/efeito
 *   §18  idempotência: retomada nunca gera efeito duplicado (versão, aprovação, task)
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO.
 */

const sequelizeModule = require('../../api/db/sequelize');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');

const RAW_MISSION = 'Corrija o defeito de soma em mathUtils sem quebrar a suíte existente.';

/**
 * PID garantidamente inexistente no formato do worker real (`mission-compiler-<pid>`) — é assim
 * que o lock de um processo morto aparece no banco. Descoberto via `process.kill(pid, 0)`.
 */
const DEAD_WORKER_ID = (() => {
  for (let pid = 990000; pid < 990100; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') return `mission-compiler-${pid}`;
    }
  }
  return 'mission-compiler-989999';
})();

let dbAvailable = false;
let dbReason = null;
const createdMissionIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  // Porta ÚNICA de infraestrutura (§11/§12): em RELEASE_AUTHORITATIVE=1 isto LANÇA INFRA_ERROR
  // (nunca PASS silencioso); em dev registra NOT_EXECUTED com motivo.
  return require('../helpers/infraGate').skipOrFail({ suite: 'engineering-mission-resume', available: dbAvailable, reason: dbReason, requirement: 'postgres' });
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
  const getModels = require('../../api/db/models');
  try {
    if (createdMissionIds.length > 0) {
      const tasks = await getModels.EngineeringMission().findAll({ where: { id: createdMissionIds } });
      const taskIds = tasks.map((t) => t.get('linked_task_id')).filter(Boolean);
      for (const taskId of taskIds) {
        const attempts = await require('../../api/services/engineeringRouter/engineeringTaskService').listAttempts(taskId);
        for (const attempt of attempts) {
          await getModels.getEngineeringTestRun().destroy({ where: { attempt_id: attempt.id } });
          await getModels.getEngineeringReview().destroy({ where: { attempt_id: attempt.id } });
        }
        await getModels.getEngineeringAttempt().destroy({ where: { task_id: taskId } });
        await getModels.getEngineeringTelemetryEvent().destroy({ where: { task_id: taskId } });
        await getModels.getEngineeringTask().destroy({ where: { id: taskId } });
      }
      await getModels.EngineeringMissionApproval().destroy({ where: { mission_id: createdMissionIds } });
      await getModels.EngineeringMissionVersion().destroy({ where: { mission_id: createdMissionIds } });
      await getModels.EngineeringMission().destroy({ where: { id: createdMissionIds } });
    }
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 20000);

describe('Engineering Mission — durable resume e idempotência', () => {
  jest.setTimeout(60000);

  test('§17 crash durante ENRICHMENT: retomada completa o enriquecimento sem duplicar versão', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-resume' });
    createdMissionIds.push(mission.id);

    // Simula um processo que morreu no meio do enriquecimento: status ENRICHING persistido e
    // lock pertencente ao worker que morreu (PID que não existe — é o que sobra no banco quando
    // o processo é morto com kill -9).
    await missionStore.updateMission(mission.id, { status: 'ENRICHING' });
    await missionStore.mergeMissionJson(mission.id, { resume: { phase: 'ENRICHING', workerId: DEAD_WORKER_ID, startedAt: new Date().toISOString() } });
    await missionStore.lockMission(mission.id, DEAD_WORKER_ID);
    expect(missionStore.lockOwnerIsDead(DEAD_WORKER_ID)).toBe(true);

    const versionsBefore = await missionStore.listVersions(mission.id);
    const summary = await orchestrator.resumeInterruptedMissions({ tenantId: 'system', autoStart: false });

    expect(summary.items.some((i) => i.missionId === mission.id && i.action === 'ENRICHED')).toBe(true);
    const after = await missionStore.getMission(mission.id);
    expect(after.status).toBe('AWAITING_APPROVAL');

    // Idempotência real: NENHUMA versão adicional foi criada pela retomada.
    const versionsAfter = await missionStore.listVersions(mission.id);
    expect(versionsAfter.length).toBe(versionsBefore.length);
    expect(after.current_version).toBe(1);
  }, 60000);

  test('§17 lock órfão expira e outro worker assume (sem deadlock após crash)', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-resume' });
    createdMissionIds.push(mission.id);
    await missionStore.lockMission(mission.id, 'worker-A');

    await expect(missionStore.lockMission(mission.id, 'worker-B'))
      .rejects.toMatchObject({ code: 'MISSION_LOCKED_BY_OTHER_WORKER' });

    // Lock obsoleto (processo morto) — o stale timeout precisa permitir a tomada.
    await missionStore.updateMission(mission.id, { locked_at: new Date(Date.now() - (missionStore.LOCK_STALE_MS + 60000)) });
    const taken = await missionStore.lockMission(mission.id, 'worker-B');
    expect(taken.locked_by).toBe('worker-B');
  }, 30000);

  test('TEST 43 crash em AWAITING_APPROVAL preserva estado, preview e decisão pendente', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-resume' });
    createdMissionIds.push(mission.id);
    const before = await missionStore.getMission(mission.id);

    const summary = await orchestrator.resumeInterruptedMissions({ tenantId: 'system', autoStart: false });
    // Missões em AWAITING_APPROVAL não são "retomáveis" por execução nem re-enriquecidas.
    expect(summary.items.some((i) => i.missionId === mission.id)).toBe(false);

    const after = await missionStore.getMission(mission.id);
    expect(after.status).toBe('AWAITING_APPROVAL');
    expect(after.current_version).toBe(before.current_version);
    expect(after.current_spec_hash).toBe(before.current_spec_hash);
    expect(after.preview.sections.length).toBeGreaterThan(0);
    const approvals = await missionStore.listApprovals(mission.id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].state).toBe('PENDING');
  }, 40000);

  test('TEST 44 crash após approval não perde a aprovação (nem autoriza outra versão)', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-resume' });
    createdMissionIds.push(mission.id);
    const approved = await approvalService.approve(mission.id, { actor: 'jest-resume' });
    expect(approved.approval.state).toBe('APPROVED');
    const approvalBefore = approved.approval.spec_hash;

    // Crash logo após aprovar (nenhuma task criada). Retomada real:
    const summary = await orchestrator.resumeInterruptedMissions({ tenantId: 'system', autoStart: false });
    expect(summary.items.some((i) => i.missionId === mission.id)).toBe(true);

    const detail = await compiler.getMissionDetail(mission.id);
    expect(detail.status).toBe('APPROVED');
    expect(detail.executionApproval).toBeTruthy();
    expect(detail.executionApproval.specHash).toBe(approvalBefore);
    expect(detail.executionApproval.state).toBe('APPROVED');
    // A retomada NÃO criou versão nova nem aprovação nova.
    expect((await missionStore.listVersions(mission.id)).length).toBe(1);
    expect((await missionStore.listApprovals(mission.id)).length).toBe(1);
  }, 40000);

  test('§18 crash entre "criar task" e "vincular task" não duplica a EngineeringTask', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-resume' });
    createdMissionIds.push(mission.id);
    await approvalService.approve(mission.id, { actor: 'jest-resume' });

    const first = await orchestrator.startExecution(mission.id, { actor: 'jest-resume', tenantId: 'system' });
    // Simula o crash exatamente nesse ponto: a task existe no banco, mas o vínculo na missão não.
    await missionStore.updateMission(mission.id, { linked_task_id: null, linked_task_ids: [], status: 'APPROVED' });

    const second = await orchestrator.startExecution(mission.id, { actor: 'jest-resume', tenantId: 'system' });
    expect(second.task.id).toBe(first.task.id);

    const allTasks = await require('../../api/db/models').getEngineeringTask().findAll({
      where: { idempotency_key: `mission:${mission.id}:v1` },
    });
    expect(allTasks).toHaveLength(1);
    createdMissionIds.push(mission.id);
  }, 40000);

  test('§18 aprovar/enriquecer repetidamente é idempotente (uma decisão, uma versão por hash)', async () => {
    if (skipIfNoDatabase()) return;
    const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-resume' });
    createdMissionIds.push(mission.id);

    const [a, b] = await Promise.all([
      compiler.enrichMission(mission.id, { actor: 'worker-1' }),
      compiler.enrichMission(mission.id, { actor: 'worker-2' }).catch((err) => err),
    ]);
    // Concorrência real: um worker pode receber o lock do outro, ou ambos convergem — em NENHUM
    // caso a versão é duplicada.
    const versions = await missionStore.listVersions(mission.id);
    const hashes = new Set(versions.map((v) => v.spec_hash));
    expect(hashes.size).toBe(versions.length);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(a || b).toBeTruthy();

    await approvalService.approve(mission.id, { actor: 'jest-resume' });
    await approvalService.approve(mission.id, { actor: 'jest-resume' });
    expect((await missionStore.listApprovals(mission.id)).length).toBe(1);
  }, 60000);
});
