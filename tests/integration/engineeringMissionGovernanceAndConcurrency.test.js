'use strict';

/**
 * Governança do ciclo de missão com banco REAL: concorrência, bypass, adulteração e
 * anti-greenwashing.
 *
 *   §33  concorrência: nenhuma execução/versão/aprovação duplicada entre workers
 *   TEST 45 tentativa de approval bypass falha
 *   TEST 46 tentativa de alterar MissionSpec aprovada silenciosamente falha
 *   TEST 40 MissionSpec antiga não é executada depois de nova versão aprovada
 *   §10  autoaprovação deixa evidência completa (preview + política + diff) e NÃO é invisível
 *   §12  autoaprovação NÃO autoriza GREEN
 *   §26/§27 GREEN não pode ser obtido por atalho (aprovado ≠ concluído; degradado ≠ verde)
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO.
 */

const sequelizeModule = require('../../api/db/sequelize');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');

const RAW_MISSION = 'Remova código morto do formatador e cubra com testes.';

let dbAvailable = false;
let dbReason = null;
const createdMissionIds = [];
const createdTaskIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[engineering-mission-governance] PULADO: postgres_unreachable (${dbReason})`);
  return true;
}

async function cleanupMission(missionId) {
  const getModels = require('../../api/db/models');
  const mission = await missionStore.getMission(missionId);
  if (mission?.linked_task_id) {
    const taskId = mission.linked_task_id;
    const attempts = await engineeringTaskService.listAttempts(taskId);
    for (const attempt of attempts) {
      await getModels.getEngineeringTestRun().destroy({ where: { attempt_id: attempt.id } });
      await getModels.getEngineeringReview().destroy({ where: { attempt_id: attempt.id } });
    }
    await getModels.getEngineeringAttempt().destroy({ where: { task_id: taskId } });
    await getModels.getEngineeringTelemetryEvent().destroy({ where: { task_id: taskId } });
    await getModels.getEngineeringTask().destroy({ where: { id: taskId } });
  }
  await getModels.EngineeringMissionApproval().destroy({ where: { mission_id: missionId } });
  await getModels.EngineeringMissionVersion().destroy({ where: { mission_id: missionId } });
  await getModels.EngineeringMission().destroy({ where: { id: missionId } });
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
  try {
    // Política restaurada ao default fail-closed — estado global do banco não pode vazar do teste.
    await missionStore.setAutoApprovalPolicy({ enabled: false, mode: 'MANUAL' }, { actor: 'jest-cleanup' });
    for (const id of createdMissionIds) await cleanupMission(id);
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 30000);

async function newMission(rawMission = RAW_MISSION, hints = {}, options = {}) {
  const { mission } = await compiler.compileMission(rawMission, { createdBy: 'jest-governance', contextHints: hints, ...options });
  createdMissionIds.push(mission.id);
  return mission;
}

describe('Engineering Mission — concorrência, bypass e anti-greenwashing', () => {
  jest.setTimeout(90000);

  test('§33 duas aprovações concorrentes produzem UMA decisão (nunca versões divergentes)', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    const results = await Promise.all([
      approvalService.approve(mission.id, { actor: 'worker-1' }),
      approvalService.approve(mission.id, { actor: 'worker-2' }),
    ]);
    expect(results.every((r) => r.approval.state === 'APPROVED')).toBe(true);
    const approvals = await missionStore.listApprovals(mission.id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].state).toBe('APPROVED');
  }, 40000);

  test('§33 duas execuções concorrentes produzem UMA EngineeringTask', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    await approvalService.approve(mission.id, { actor: 'jest-governance' });
    const [a, b] = await Promise.all([
      orchestrator.startExecution(mission.id, { actor: 'worker-1', tenantId: 'system' }),
      orchestrator.startExecution(mission.id, { actor: 'worker-2', tenantId: 'system' }),
    ]);
    createdTaskIds.push(a.task.id);
    expect(a.task.id).toBe(b.task.id);
    const tasks = await require('../../api/db/models').getEngineeringTask().findAll({
      where: { idempotency_key: `mission:${mission.id}:v1` },
    });
    expect(tasks).toHaveLength(1);
  }, 40000);

  test('TEST 45 approval bypass falha em todos os vetores conhecidos', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();

    // (a) sem nenhuma aprovação
    await expect(orchestrator.startExecution(mission.id, { tenantId: 'system' }))
      .rejects.toMatchObject({ code: 'MISSION_APPROVAL_NOT_FOUND' });

    // (b) aprovação PENDING (existe, mas não autoriza)
    const approvals = await missionStore.listApprovals(mission.id);
    expect(approvals[0].state).toBe('PENDING');
    await expect(approvalService.assertMissionExecutable(mission.id))
      .rejects.toMatchObject({ code: 'MISSION_APPROVAL_NOT_FOUND' });

    // (c) mission rejeitada não pode ser aprovada depois
    const rejected = await newMission('Remova código morto do formatador.');
    await approvalService.reject(rejected.id, { actor: 'jest-governance', reason: 'fora de escopo' });
    await expect(approvalService.approve(rejected.id, { actor: 'jest-governance' }))
      .rejects.toMatchObject({ code: 'MISSION_REJECTED' });

    // (d) rejeição registrada impede execução
    await expect(orchestrator.startExecution(rejected.id, { tenantId: 'system' }))
      .rejects.toMatchObject({ code: 'MISSION_APPROVAL_NOT_FOUND' });
  }, 60000);

  test('TEST 46 adulteração silenciosa da MissionSpec aprovada é detectada', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    await approvalService.approve(mission.id, { actor: 'jest-governance' });
    await expect(approvalService.assertMissionExecutable(mission.id)).resolves.toBeTruthy();

    // Adulteração: altera a SPEC persistida sem atualizar `spec_hash` (mutação silenciosa — o
    // cenário exato que a aprovação versionada precisa detectar).
    const getModels = require('../../api/db/models');
    const versionRow = await getModels.EngineeringMissionVersion().findOne({
      where: { mission_id: mission.id, version: mission.current_version },
    });
    const tampered = { ...versionRow.get('spec'), objective: 'objetivo trocado depois da aprovação' };
    await versionRow.update({ spec: tampered });

    await expect(approvalService.assertMissionExecutable(mission.id))
      .rejects.toMatchObject({ code: 'MISSION_STALE_VERSION' });
    await expect(orchestrator.startExecution(mission.id, { tenantId: 'system' }))
      .rejects.toMatchObject({ code: 'MISSION_STALE_VERSION' });
  }, 40000);

  test('TEST 40 versão antiga não executa depois de nova versão aprovada', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    await approvalService.approve(mission.id, { actor: 'jest-governance' });
    const approvedV1 = await missionStore.getCurrentVersion(mission.id);
    expect(approvedV1.version).toBe(1);

    // Nova descoberta material → v2 (re-enriquecimento contínuo).
    const detail = await approvalService.reEnrich(mission.id, { actor: 'jest-governance', contextHints: { touchesSecrets: true } });
    expect(detail.current_version).toBe(2);
    expect(detail.status).toBe('AWAITING_APPROVAL');

    // A aprovação de v1 NÃO autoriza v2.
    await expect(orchestrator.startExecution(mission.id, { tenantId: 'system' }))
      .rejects.toMatchObject({ code: 'MISSION_APPROVAL_NOT_FOUND' });

    // Aprovar v2 libera APENAS v2.
    await approvalService.approve(mission.id, { actor: 'jest-governance' });
    const started = await orchestrator.startExecution(mission.id, { tenantId: 'system' });
    createdTaskIds.push(started.task.id);
    expect(started.mission.current_version).toBe(2);
    expect(started.approval.specVersion).toBe(2);
  }, 60000);

  test('§10 autoaprovação deixa evidência completa e permanece inspecionável', async () => {
    if (skipIfNoDatabase()) return;
    await missionStore.setAutoApprovalPolicy({
      enabled: true,
      mode: 'POLICY_BASED',
      maxRisk: 'HIGH',
      confidenceThreshold: 0.2,
      allowedBranches: ['main'],
      allowedScopes: ['SMALL', 'MEDIUM'],
      allowedMissionTypes: [],
      allowDerivedRequirements: true,
      allowPolicyRequirements: true,
    }, { actor: 'jest-governance' });

    const mission = await newMission('Remova código morto do formatador e cubra com testes.');
    expect(mission.status).toBe('APPROVED');
    expect(mission.approval_state).toBe('AUTO_APPROVED');
    expect(mission.displayStatus).toBe('AUTO_APPROVED'); // distinto de APPROVED na UI/API

    // O preview continua existindo e persistido (automação NUNCA é execução invisível).
    expect(mission.preview).toBeTruthy();
    expect(mission.preview.sections.length).toBeGreaterThan(0);
    expect(mission.preview.autoApproval.eligible).toBe(true);
    expect(mission.preview.autoApproval.policyId).toBeTruthy();

    const approvals = await missionStore.listApprovals(mission.id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].state).toBe('AUTO_APPROVED');
    expect(approvals[0].policy_id).toBeTruthy();
    expect(approvals[0].rules_evaluated.length).toBeGreaterThan(0);
    expect(approvals[0].actor).toBe('SYSTEM:AUTO_APPROVAL_POLICY');
    expect(approvals[0].decision_reason).toMatch(/autoaprovada pela política/);

    // §12: autoaprovação autoriza EXECUÇÃO, nunca GREEN.
    const detail = await compiler.getMissionDetail(mission.id);
    expect(detail.status).toBe('APPROVED');
    expect(detail.displayStatus).toBe('AUTO_APPROVED');
    expect(detail.status).not.toBe('GREEN');
  }, 60000);

  test('§11/§12 missão crítica NÃO é autoaprovada mesmo com política habilitada', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission('Revise as credenciais de tenant e o RBAC do importador.', { touchesSecrets: true, touchesRbac: true });
    expect(mission.status).toBe('AWAITING_APPROVAL');
    expect(mission.approval_state).toBe('PENDING');
    const approvals = await missionStore.listApprovals(mission.id);
    expect(approvals[0].blockers.length).toBeGreaterThan(0);
    expect(approvals[0].blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['SECRET_EXPOSURE']));
  }, 40000);

  test('§26/§27 anti-greenwashing: aprovado ≠ concluído e degradado ≠ verde', async () => {
    if (skipIfNoDatabase()) return;
    await missionStore.setAutoApprovalPolicy({ enabled: false, mode: 'MANUAL' }, { actor: 'jest-governance' });
    const mission = await newMission();
    await approvalService.approve(mission.id, { actor: 'jest-governance' });

    // Aprovada, sem execução ⇒ NUNCA GREEN.
    let detail = await compiler.getMissionDetail(mission.id);
    expect(detail.status).toBe('APPROVED');
    expect(detail.displayStatus).toBe('APPROVED');

    const started = await orchestrator.startExecution(mission.id, { tenantId: 'system' });
    createdTaskIds.push(started.task.id);

    // Task em READY_FOR_PROMOTION (gates passaram, promoção não completou) ⇒ DEGRADED, nunca GREEN.
    const getModels = require('../../api/db/models');
    await getModels.getEngineeringTask().update({ status: 'READY_FOR_PROMOTION' }, { where: { id: started.task.id } });
    detail = await orchestrator.refreshMissionState(mission.id, { tenantId: 'system' });
    expect(detail.displayStatus).toBe('DEGRADED');
    expect(detail.status).toBe('DEGRADED');
    expect(detail.status).not.toBe('GREEN');

    // Task ainda em execução ⇒ RUNNING, nunca GREEN.
    await getModels.getEngineeringTask().update({ status: 'CODING' }, { where: { id: started.task.id } });
    detail = await orchestrator.refreshMissionState(mission.id, { tenantId: 'system' });
    expect(detail.displayStatus).toBe('RUNNING');

    // Só a task REALMENTE GREEN produz missão GREEN.
    await getModels.getEngineeringTask().update({ status: 'GREEN' }, { where: { id: started.task.id } });
    detail = await orchestrator.refreshMissionState(mission.id, { tenantId: 'system' });
    expect(detail.displayStatus).toBe('GREEN');
    expect(detail.status).toBe('GREEN');
    expect(detail.completed_at).toBeTruthy();
  }, 60000);

  test('§42 status exibido jamais colapsa estados distintos', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newMission();
    const enriched = await compiler.getMissionDetail(mission.id);
    expect(enriched.displayStatus).toBe('AWAITING_APPROVAL');

    await approvalService.approve(mission.id, { actor: 'jest-governance' });
    const approved = await compiler.getMissionDetail(mission.id);
    expect(approved.displayStatus).toBe('APPROVED');

    const statuses = new Set([enriched.displayStatus, approved.displayStatus]);
    expect(statuses.size).toBe(2);
    expect([...statuses]).not.toContain('GREEN');
  }, 40000);
});
