'use strict';

/**
 * STALE_MISSION_SPEC com banco REAL (§22/§23).
 *
 * LACUNA PRECISA (medida em 2026-09-25): a cobertura existente (TEST 40, em
 * `engineeringMissionGovernanceAndConcurrency.test.js`) prova que a APROVAÇÃO de v1 não autoriza
 * v2 — ou seja, o gating de ENTRADA. O que NÃO existia era defesa para a task JÁ CRIADA/EM
 * EXECUÇÃO: `EngineeringTask` não guardava `mission_id`/`mission_version`/`spec_hash`, então uma
 * task da v1 seguia em CODING→…→PROMOTING (efeito real no git) depois de a v2 estar aprovada.
 *
 * Aqui se prova, contra o banco real:
 *   1. a task criada pelo orquestrador DECLARA de qual versão da MissionSpec veio;
 *   2. o frescor é MEDIDO e devolve estado + ESTRATÉGIA;
 *   3. a fase material é RECUSADA com erro explícito (nunca "segue em silêncio");
 *   4. a resolução SUPERSEDE cancela a task obsoleta e marca o substituto;
 *   5. trabalho material NÃO é destruído: vira RECONCILE (decisão humana).
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO (via porta única de infraestrutura).
 */

const sequelizeModule = require('../../api/db/sequelize');
const compiler = require('../../api/services/engineeringMission/missionCompilerService');
const approvalService = require('../../api/services/engineeringMission/missionApprovalService');
const orchestrator = require('../../api/services/engineeringMission/missionOrchestratorService');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const taskSpecBinding = require('../../api/services/engineeringMission/taskSpecBindingService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { SPEC_STATES, SPEC_STRATEGIES } = require('../../engine/engineeringMission/missionSpecFreshness');

const RAW_MISSION = 'Remova código morto do formatador e cubra com testes.';

let dbAvailable = false;
let dbReason = null;
const createdMissionIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  return require('../helpers/infraGate').skipOrFail({ suite: 'engineering-mission-stale-spec', available: dbAvailable, reason: dbReason, requirement: 'postgres' });
}

async function cleanupMission(missionId) {
  const models = require('../../api/db/models');
  const mission = await missionStore.getMission(missionId);
  const taskIds = Array.isArray(mission?.linked_task_ids) ? mission.linked_task_ids : [];
  if (mission?.linked_task_id && !taskIds.includes(mission.linked_task_id)) taskIds.push(mission.linked_task_id);
  for (const taskId of taskIds) {
    const attempts = await engineeringTaskService.listAttempts(taskId);
    for (const attempt of attempts) {
      await models.getEngineeringTestRun().destroy({ where: { attempt_id: attempt.id } });
      await models.getEngineeringReview().destroy({ where: { attempt_id: attempt.id } });
    }
    await models.getEngineeringAttempt().destroy({ where: { task_id: taskId } });
    await models.getEngineeringTelemetryEvent().destroy({ where: { task_id: taskId } });
    await models.getEngineeringTask().destroy({ where: { id: taskId } });
  }
  await models.EngineeringMissionApproval().destroy({ where: { mission_id: missionId } });
  await models.EngineeringMissionVersion().destroy({ where: { mission_id: missionId } });
  await models.EngineeringMission().destroy({ where: { id: missionId } });
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
    await missionStore.setAutoApprovalPolicy({ enabled: false, mode: 'MANUAL' }, { actor: 'jest-cleanup' });
    for (const id of createdMissionIds) await cleanupMission(id);
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 30000);

async function newApprovedMission() {
  const { mission } = await compiler.compileMission(RAW_MISSION, { createdBy: 'jest-stale-spec', contextHints: {} });
  createdMissionIds.push(mission.id);
  await approvalService.approve(mission.id, { actor: 'jest-stale-spec' });
  return mission;
}

/** Leva a missão à v2 aprovada (re-enriquecimento com descoberta material). */
async function advanceToApprovedV2(missionId) {
  const detail = await approvalService.reEnrich(missionId, { actor: 'jest-stale-spec', contextHints: { touchesSecrets: true } });
  expect(detail.current_version).toBe(2);
  await approvalService.approve(missionId, { actor: 'jest-stale-spec' });
  const current = await missionStore.getCurrentVersion(missionId);
  expect(current.spec.version).toBe(2);
  return current;
}

describe('STALE_MISSION_SPEC — vínculo da task com a versão da MissionSpec (banco real)', () => {
  test('VINCULO_DECLARADO: a task criada pelo orquestrador declara missão, versão e hash', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newApprovedMission();
    const started = await orchestrator.startExecution(mission.id, { tenantId: 'system', actor: 'jest-stale-spec' });

    const task = await engineeringTaskService.getTask(started.task.id);
    const current = await missionStore.getCurrentVersion(mission.id);
    expect(task.mission_id).toBe(mission.id);
    expect(task.mission_version).toBe(1);
    expect(task.mission_spec_hash).toBe(current.spec.specHash);
    expect(task.mission_spec_state).toBe(SPEC_STATES.CURRENT);

    // Frescor imediato: vinculada e corrente.
    const { assessment } = await taskSpecBinding.assessTaskSpecFreshness(started.task.id);
    expect(assessment.state).toBe(SPEC_STATES.CURRENT);
    expect(assessment.strategy).toBe(SPEC_STRATEGIES.PROCEED);
  }, 90000);

  test('FASE_MATERIAL_RECUSADA: task da v1 não avança depois da v2 aprovada', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newApprovedMission();
    const started = await orchestrator.startExecution(mission.id, { tenantId: 'system', actor: 'jest-stale-spec' });
    const staleTaskId = started.task.id;

    await advanceToApprovedV2(mission.id);

    // A task continua em estado não-material (a execução real não foi disparada aqui).
    const assessment = await taskSpecBinding.assessTaskSpecFreshness(staleTaskId);
    expect(assessment.assessment.state).toBe(SPEC_STATES.SUPERSEDED);
    expect(assessment.assessment.strategy).toBe(SPEC_STRATEGIES.SUPERSEDE);

    // Guard de fase material: recusa EXPLÍCITA, com estado e estratégia no erro.
    await expect(taskSpecBinding.assertTaskSpecFresh(staleTaskId, { phase: 'CODING' }))
      .rejects.toMatchObject({
        code: 'MISSION_SPEC_STALE',
        state: SPEC_STATES.SUPERSEDED,
        strategy: SPEC_STRATEGIES.SUPERSEDE,
        phase: 'CODING',
      });

    // A recusa deixa EVIDÊNCIA persistida na task (estado medido, não presumido).
    const afterRefusal = await engineeringTaskService.getTask(staleTaskId);
    expect(afterRefusal.mission_spec_state).toBe(SPEC_STATES.SUPERSEDED);
    expect(afterRefusal.mission_spec_checked_at).toBeTruthy();

    // E o boundary da missão também recusa (nenhuma fase material pela porta da missão).
    await expect(orchestrator.runMissionTask(mission.id, { tenantId: 'system' }))
      .rejects.toMatchObject({ code: 'MISSION_SPEC_STALE' });
  }, 120000);

  test('SUPERSEDE: a execução da v2 encerra a task obsoleta e marca o substituto', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newApprovedMission();
    const v1 = await orchestrator.startExecution(mission.id, { tenantId: 'system', actor: 'jest-stale-spec' });

    await advanceToApprovedV2(mission.id);
    const v2 = await orchestrator.startExecution(mission.id, { tenantId: 'system', actor: 'jest-stale-spec' });

    expect(v2.task.id).not.toBe(v1.task.id);

    const staleTask = await engineeringTaskService.getTask(v1.task.id);
    expect(staleTask.status).toBe('CANCELLED');
    expect(staleTask.superseded_by_task_id).toBe(v2.task.id);

    const freshTask = await engineeringTaskService.getTask(v2.task.id);
    expect(freshTask.mission_version).toBe(2);
    expect(freshTask.mission_id).toBe(mission.id);

    // A missão aponta para a task nova e o histórico preserva as duas (nada é apagado).
    const updated = await missionStore.getMission(mission.id);
    expect(updated.linked_task_id).toBe(v2.task.id);
    expect(updated.linked_task_ids).toEqual(expect.arrayContaining([v1.task.id, v2.task.id]));
  }, 150000);

  test('RECONCILE: trabalho material NÃO é destruído por mudança de spec', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newApprovedMission();
    const v1 = await orchestrator.startExecution(mission.id, { tenantId: 'system', actor: 'jest-stale-spec' });

    // Simula trabalho real já produzido (patch/testes). A task nasce em CLASSIFIED (o createTask
    // já classifica), então o caminho material é ROUTED -> CODING -> TESTING.
    const initial = await engineeringTaskService.getTask(v1.task.id);
    expect(initial.status).toBe('CLASSIFIED');
    await engineeringTaskService.transitionTask(v1.task.id, 'ROUTED');
    await engineeringTaskService.transitionTask(v1.task.id, 'CODING');
    await engineeringTaskService.transitionTask(v1.task.id, 'TESTING');

    await advanceToApprovedV2(mission.id);

    const { assessment } = await taskSpecBinding.assessTaskSpecFreshness(v1.task.id);
    expect(assessment.state).toBe(SPEC_STATES.SUPERSEDED);
    expect(assessment.strategy).toBe(SPEC_STRATEGIES.RECONCILE);
    expect(assessment.material).toBe(true);

    // A resolução NÃO cancela: fica PENDENTE DE DECISÃO HUMANA.
    const outcome = await taskSpecBinding.resolveStaleTask(v1.task.id, { supersededByTaskId: null, actor: 'jest-stale-spec' });
    expect(outcome.applied).toBe('PENDING_DECISION');

    const preserved = await engineeringTaskService.getTask(v1.task.id);
    expect(preserved.status).toBe('TESTING');
    expect(preserved.mission_spec_state).toBe(SPEC_STATES.SUPERSEDED);
    expect(preserved.last_error?.pendingDecision).toBe(true);
    expect(preserved.last_error?.strategy).toBe(SPEC_STRATEGIES.RECONCILE);
  }, 150000);

  test('BACKFILL: vínculo derivável é derivado e MARCADO como derivado (nunca inventado)', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newApprovedMission();
    const started = await orchestrator.startExecution(mission.id, { tenantId: 'system', actor: 'jest-stale-spec' });

    // Remove o vínculo declarado, simulando uma task criada antes das colunas existirem.
    await engineeringTaskService.updateTaskFields(started.task.id, {
      mission_id: null,
      mission_version: null,
      mission_spec_hash: null,
      mission_spec_state: null,
    });
    const before = await engineeringTaskService.getTask(started.task.id);
    expect(before.mission_id).toBeNull();

    const result = await taskSpecBinding.assessTaskSpecFreshness(started.task.id);
    expect(result.derived).toBe(true);
    expect(result.binding.missionId).toBe(mission.id);
    expect(result.binding.missionVersion).toBe(1);
    expect(result.assessment.state).toBe(SPEC_STATES.CURRENT);

    const after = await engineeringTaskService.getTask(started.task.id);
    expect(after.mission_id).toBe(mission.id);
  }, 90000);

  test('ENFORCEMENT: updateTaskFields recusa escrita de ESTADO (não vira bypass do fencing)', async () => {
    if (skipIfNoDatabase()) return;
    const mission = await newApprovedMission();
    const started = await orchestrator.startExecution(mission.id, { tenantId: 'system', actor: 'jest-stale-spec' });

    await expect(engineeringTaskService.updateTaskFields(started.task.id, { status: 'GREEN' }))
      .rejects.toMatchObject({ code: 'TASK_METADATA_FIELD_NOT_ALLOWED', fields: ['status'] });

    const task = await engineeringTaskService.getTask(started.task.id);
    expect(task.status).not.toBe('GREEN');
  }, 90000);
});
