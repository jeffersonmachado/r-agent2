'use strict';

/**
 * PÓS-FIX — falha de contrato/infra NÃO é recorrência; recorrência REAL continua detectável.
 *
 * Prova o caminho de produção (`bugLoopCoordinatorService.hookMissionFailure`) com banco real, sem
 * sandbox: dois cenários sobre a MESMA missão e o MESMO finding já fechado.
 *
 *   1. falha de contrato (`NO_PATCH_SCOPE` na task substituta) ⇒ finding corrigido PERMANECE
 *      CLOSED (`recurrence_count` não sobe) e a falha é registrada como finding PRÓPRIO;
 *   2. falha de aplicação real (teste falhando) ⇒ recorrência É registrada (`RECURRENCE`),
 *      porque o bug voltou de verdade.
 *
 * Sem o item 2 o item 1 seria "mascarar recorrência" — é o par que dá sentido à regra.
 */

const path = require('path');

const TEST_TENANT_KEY = 'jest-e2e-postfix-recurrence';
process.env.ENGINEERING_ROUTER_TENANT_ID = TEST_TENANT_KEY;

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const models = require('../../api/db/models');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const bugFindingService = require('../../api/services/engineeringMission/bugFindingService');
const coordinator = require('../../api/services/engineeringMission/bugLoopCoordinatorService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');

const ROOT = path.resolve(__dirname, '..', '..');
let dbAvailable = false;
let dbReason = 'desconhecido';
const criados = { tasks: [], missions: [], findings: [] };

async function criarMissao() {
  const mission = await missionStore.createMission({
    originalMission: `postfix ${Date.now()}`,
    title: 'Post-fix recurrence',
    missionType: 'INVESTIGATION',
    createdBy: 'jest-postfix',
    idempotencyKey: `postfix:${Date.now()}`,
  });
  criados.missions.push(mission.mission.id);
  return mission.mission.id;
}

async function criarTask(missionId, { status = 'CLASSIFIED' } = {}) {
  const task = await engineeringTaskService.createTask({
    title: 'task postfix',
    objective: 'cenário pós-fix',
    taskType: 'IMPLEMENT',
    risk: 'LOW',
    scope: 'LOW',
    allowedPaths: ['tests/fixtures/engineering-router-sandbox/'],
    testCommands: [],
    missionId,
  }, { createdBy: 'jest-postfix', idempotencyKey: `postfix-task:${missionId}:${Date.now()}` });
  criados.tasks.push(task.id);
  if (status !== 'CREATED') await engineeringTaskService.transitionTask(task.id, status).catch(() => {});
  return engineeringTaskService.getTask(task.id);
}

/** Finding do MESMO escopo que o hook vai calcular — fechado, como no ciclo real. */
async function criarFindingFechado(missionId, taskId) {
  const registrado = await bugFindingService.registerFinding({
    missionId,
    taskId,
    source: 'INTEGRATION_TEST',
    title: `Missão ${missionId}: task ${taskId} terminou em RED`,
    description: 'finding de fixture',
    expectedBehavior: 'a task da missão conclui em GREEN pelos seus próprios gates',
    observedBehavior: 'status=RED',
    category: 'BUG',
    subsystem: 'ENGINEERING_MISSION',
    symbol: 'mission_task:RED',
    affectedFiles: ['tests/fixtures/engineering-router-sandbox/'],
  }, { actor: 'jest-postfix', tenantId: TEST_TENANT_KEY });
  const id = registrado.finding.id;
  criados.findings.push(id);
  // Leva até CLOSED pelo caminho canônico, para que `isRecurrence` valha no hook.
  for (const estado of ['REPRODUCING', 'CONFIRMED', 'FIXING', 'FIXED', 'REGRESSION_VALIDATED', 'CLOSED']) {
    await bugFindingService.transitionFinding(id, estado, { actor: 'jest-postfix' }).catch(() => {});
  }
  const fechado = await bugFindingService.getFinding(id);
  expect(fechado.status).toBe('CLOSED');
  return fechado;
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
  }
  if (!dbAvailable) return;
  await models.getTenant().findOrCreate({
    where: { tenant_key: TEST_TENANT_KEY },
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Post-fix', status: 'active', plan: 'enterprise' },
  });
  for (const provider of ['anthropic', 'mistral', 'kimi', 'deepseek', 'openai', 'qwen', 'groq']) {
    registerAiProvider(provider, { async generate() { return { text: JSON.stringify({}), usage: {} }; } });
  }
}, 120000);

afterAll(async () => {
  clearAiProviderConfig();
  if (!dbAvailable) return;
  for (const id of criados.findings) {
    await models.getEngineeringBugFindingEvent().destroy({ where: { finding_id: id } }).catch(() => {});
    await models.getEngineeringBugFinding().destroy({ where: { id } }).catch(() => {});
  }
  for (const taskId of criados.tasks) {
    await models.getEngineeringAttempt().destroy({ where: { task_id: taskId } }).catch(() => {});
    await models.getEngineeringTask().destroy({ where: { id: taskId } }).catch(() => {});
  }
  for (const missionId of criados.missions) {
    await models.EngineeringMission().destroy({ where: { id: missionId } }).catch(() => {});
  }
  await sequelizeModule.close();
}, 120000);

describe('pós-fix — contrato × recorrência comprovada', () => {
  test('falha de CONTRATO na retomada NÃO reabre o finding corrigido', async () => {
    if (!dbAvailable) return skipOrFail({ reason: `banco indisponível: ${dbReason}`, code: 'DB_UNAVAILABLE' });

    const missionId = await criarMissao();
    const taskOriginal = await criarTask(missionId, { status: 'CLASSIFIED' });
    const fechado = await criarFindingFechado(missionId, taskOriginal.id);

    // Task substituta cujo attempt falhou por CONTRATO (escopo não resolvido) — o caso medido.
    const taskSubstituta = await criarTask(missionId, { status: 'CLASSIFIED' });
    await models.getEngineeringAttempt().create({
      task_id: taskSubstituta.id,
      attempt_number: 1,
      status: 'FAILED',
      coder_provider: 'anthropic',
      coder_model: 'claude-haiku-4-5-20251001',
      error: { code: 'NO_PATCH_SCOPE', message: 'task sem escopo de patch declarado' },
    });

    await coordinator.hookMissionFailure(
      { missionId, taskId: taskSubstituta.id, result: { status: 'RED', reasonCode: 'ENGINEERING_TASK_EXHAUSTED' } },
      { actor: 'SYSTEM:MISSION', tenantId: TEST_TENANT_KEY },
    );

    const depois = await bugFindingService.getFinding(fechado.id);
    expect(depois.status).toBe('CLOSED');
    expect(depois.recurrence_count || 0).toBe(0);

    // A falha NÃO desapareceu: virou um finding PRÓPRIO, com fingerprint de contrato.
    const separados = await bugFindingService.listFindings({ fingerprint: `coder-contract:${missionId}:coder_contract`, limit: 5 });
    expect(separados.length).toBeGreaterThan(0);
    criados.findings.push(...separados.map((f) => f.id));
  }, 120000);

  test('recorrência REAL (aplicação) É detectada e reabre o finding', async () => {
    if (!dbAvailable) return skipOrFail({ reason: `banco indisponível: ${dbReason}`, code: 'DB_UNAVAILABLE' });

    const missionId = await criarMissao();
    // MESMA task nas duas chamadas: é assim que a produção se comporta quando o mesmo contrato
    // volta a falhar por mérito — o fingerprint deriva do título, que carrega a task.
    const task = await criarTask(missionId, { status: 'CLASSIFIED' });
    await models.getEngineeringAttempt().create({
      task_id: task.id,
      attempt_number: 1,
      status: 'FAILED',
      coder_provider: 'anthropic',
      coder_model: 'claude-haiku-4-5-20251001',
      error: { code: 'REGRESSION_FAILED', message: 'o teste da spec voltou a falhar' },
    });

    // 1ª observação: o finding nasce pelo caminho de produção.
    await coordinator.hookMissionFailure(
      { missionId, taskId: task.id, result: { status: 'RED', reasonCode: 'ENGINEERING_TASK_EXHAUSTED' } },
      { actor: 'SYSTEM:MISSION', tenantId: TEST_TENANT_KEY },
    );
    const criado = (await bugFindingService.listFindings({ missionId, limit: 5 }))[0];
    expect(criado).toBeTruthy();
    criados.findings.push(criado.id);
    for (const estado of ['REPRODUCING', 'CONFIRMED', 'FIXING', 'FIXED', 'REGRESSION_VALIDATED', 'CLOSED']) {
      await bugFindingService.transitionFinding(criado.id, estado, { actor: 'jest-postfix' }).catch(() => {});
    }
    expect((await bugFindingService.getFinding(criado.id)).status).toBe('CLOSED');

    // 2ª observação: MESMA falha de mérito ⇒ recorrência comprovada, não silêncio.
    await coordinator.hookMissionFailure(
      { missionId, taskId: task.id, result: { status: 'RED', reasonCode: 'ENGINEERING_TASK_EXHAUSTED' } },
      { actor: 'SYSTEM:MISSION', tenantId: TEST_TENANT_KEY },
    );

    const depois = await bugFindingService.getFinding(criado.id);
    expect(depois.status).toBe('CONFIRMED');
    expect(depois.recurrence_count).toBeGreaterThanOrEqual(1);
    expect(depois.resolved_at).toBeNull();
  }, 120000);
});
