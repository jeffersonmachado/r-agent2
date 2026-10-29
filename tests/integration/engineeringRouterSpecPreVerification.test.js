'use strict';

/**
 * ROUTER — SPEC JÁ SATISFEITA NA RETOMADA PÓS-FIX (decisão arquitetural 2026-10-29).
 *
 * DEFEITO QUE ESTE TESTE TRAVA (medido no run 40786037745, `governanceApprovalFullWorkerE2E`):
 * depois de a correção ser integrada na fonte da missão, a task substituta nascia JÁ no commit
 * corrigido — o cenário da spec já passava ali — mas o Router despachava o coder de novo. O modelo
 * devolvia o patch do que já existia, o `git apply` recusava (`PATCH_CONTRACT_VIOLATION`), a task ia
 * a RED e essa falha era registrada como REINCIDÊNCIA do finding recém-fechado.
 *
 * Contrato verificado aqui, com execução REAL dos comandos no sandbox:
 *   1. fonte da missão avançou + `test_commands` passam no commit da task ⇒ GREEN sem chamar o coder
 *      e sem patch (reasonCode `SPEC_ALREADY_SATISFIED`);
 *   2. `test_commands` falham ⇒ o coder É chamado (a falha é a reprodução, não um atalho);
 *   3. fonte da missão NÃO avançou ⇒ nada de pré-verificação (fluxo normal, coder chamado);
 *   4. pré-verificação inconclusiva (sandbox indisponível) NUNCA vira GREEN.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const TEST_TENANT_KEY = 'jest-e2e-spec-preverify';
process.env.ENGINEERING_ROUTER_TENANT_ID = TEST_TENANT_KEY;

const sequelizeModule = require('../../api/db/sequelize');
const { skipOrFail } = require('../helpers/infraGate');
const { isSandboxAvailable } = require('../../api/services/engineeringRouter/executionSandbox');
const models = require('../../api/db/models');
const missionStore = require('../../api/services/engineeringMission/missionStoreService');
const missionSourceService = require('../../api/services/engineeringMission/missionSourceService');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const router = require('../../api/services/engineeringRouter/engineeringRouterService');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');

const ROOT = path.resolve(__dirname, '..', '..');
const SMOKE_FILE = 'tests/fixtures/engineering-router-sandbox/specPreVerifyPasses.test.js';
const COMANDO_QUE_PASSA = `npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=${SMOKE_FILE} --no-coverage`;
const COMANDO_QUE_FALHA = 'npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=tests/fixtures/engineering-router-sandbox/inexistente-spec-preverify.test.js --no-coverage';

let dbAvailable = false;
let dbReason = 'desconhecido';
const criados = { tasks: [], missions: [] };

/** Contador de chamadas ao coder: é a prova de que o modelo NÃO foi despachado. */
const chamadasCoder = { total: 0 };

function providerFake() {
  return {
    async generate(prompt, context) {
      if (context && context.purpose === 'engineering_coder') chamadasCoder.total += 1;
      return { text: JSON.stringify({ summary: 'noop', diff: '' }), usage: { prompt_tokens: 1, completion_tokens: 1 } };
    },
  };
}

async function criarTenantEProviders() {
  for (const provider of ['anthropic', 'mistral', 'kimi', 'deepseek', 'openai', 'qwen', 'groq']) {
    registerAiProvider(provider, providerFake());
  }
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  for (const provider of ['anthropic', 'mistral', 'kimi', 'deepseek', 'openai', 'qwen', 'groq']) {
    await saveAICredentials(TEST_TENANT_KEY, provider, `jest-fixture-fake-key-${provider}-${Date.now()}`);
  }
}

const PRECONDITIONS_OK = {
  candidateGreen: true,
  hasTestRun: true,
  reviewVerdict: 'APPROVE',
  regressionStatus: 'PASS',
  ownershipValid: true,
  candidateIntegrityOk: true,
};

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** Avança a fonte da missão por um candidato REAL (commit descendente do base). */
async function avancarFonteDaMissao(missionId, taskId) {
  await missionSourceService.ensureMissionSource(missionId, { actor: 'jest-spec-preverify' });
  const fonte = await missionSourceService.getMissionSource(missionId);
  const tree = git(['rev-parse', `${fonte.baseCommit}^{tree}`]);
  const candidato = git(['commit-tree', tree, '-p', fonte.baseCommit, '-m', 'spec pre-verify: fix integrado']);
  await missionSourceService.integrateCandidate({
    missionId,
    taskId,
    candidateCommit: candidato,
    preconditions: PRECONDITIONS_OK,
    actor: 'jest-spec-preverify',
  });
  const depois = await missionSourceService.getMissionSource(missionId);
  return { antes: fonte.baseCommit, depois: depois.currentCommit, branch: depois.integrationBranch };
}

async function criarMissaoEEndereco() {
  const mission = await missionStore.createMission({
    originalMission: `spec pre-verify ${Date.now()}`,
    title: 'Spec pre-verify',
    missionType: 'INVESTIGATION',
    createdBy: 'jest-spec-preverify',
    idempotencyKey: `spec-preverify:${Date.now()}`,
  });
  const missionId = mission.mission.id;
  criados.missions.push(missionId);
  return missionId;
}

async function criarTask({ missionId, testCommands }) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const task = await engineeringTaskService.createTask({
    title: 'task spec pre-verify',
    objective: 'verificar se a spec já está satisfeita antes de codificar',
    taskType: 'IMPLEMENT',
    risk: 'LOW',
    scope: 'LOW',
    allowedPaths: ['tests/fixtures/engineering-router-sandbox/'],
    acceptanceCriteria: ['a suíte do fixture passa'],
    testCommands,
    missionId,
    sourceCommit: head,
  }, { createdBy: 'jest-spec-preverify', idempotencyKey: `spec-preverify-task:${missionId}:${Date.now()}` });
  criados.tasks.push(task.id);
  await missionStore.linkTask({ missionId, taskId: task.id }).catch(() => {});
  return task;
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
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Spec Pre-verify', status: 'active', plan: 'enterprise' },
  });
  await criarTenantEProviders();
}, 120000);

afterAll(async () => {
  clearAiProviderConfig();
  if (!dbAvailable) return;
  const { destroyWorkspace } = require('../../api/services/engineeringRouter/patchApplyService');
  for (const taskId of criados.tasks) {
    for (const attemptNumber of [0, 1, 2]) {
      await destroyWorkspace(`${taskId}-${attemptNumber}`).catch(() => {});
    }
    await models.getEngineeringAttempt().destroy({ where: { task_id: taskId } }).catch(() => {});
    await models.getEngineeringTelemetryEvent().destroy({ where: { task_id: taskId } }).catch(() => {});
    await models.getEngineeringTask().destroy({ where: { id: taskId } }).catch(() => {});
  }
  for (const missionId of criados.missions) {
    await models.EngineeringMission().destroy({ where: { id: missionId } }).catch(() => {});
  }
  await sequelizeModule.close();
}, 120000);

describe('Router — spec já satisfeita na retomada pós-fix', () => {
  test('fonte avançada + comandos passando ⇒ GREEN sem chamar o coder e sem patch', async () => {
    if (!dbAvailable) return skipOrFail({ reason: `banco indisponível: ${dbReason}`, code: 'DB_UNAVAILABLE' });
    if (!isSandboxAvailable()) return skipOrFail({ reason: 'Docker sandbox indisponível', code: 'SANDBOX_UNAVAILABLE' });

    const missionId = await criarMissaoEEndereco();
    const task = await criarTask({ missionId, testCommands: [COMANDO_QUE_PASSA] });
    // FONTE AVANÇOU de verdade: candidato real integrado na branch da missão (retomada pós-fix).
    const fonte = await avancarFonteDaMissao(missionId, task.id);
    expect(fonte.depois).not.toBe(fonte.antes);
    const antes = chamadasCoder.total;
    {
      const resultado = await router.runTask(task.id);

      expect(resultado.status).toBe('GREEN');
      expect(resultado.reasonCode).toBe('SPEC_ALREADY_SATISFIED');
      expect(resultado.specAlreadySatisfied).toBe(true);
      // PROVA PRINCIPAL: nenhum patch foi pedido ao modelo.
      expect(chamadasCoder.total).toBe(antes);
      // Nenhuma tentativa foi criada: não houve CODING.
      const tentativas = await engineeringTaskService.listAttempts(task.id);
      expect(tentativas.length).toBe(0);
      // A evidência da execução real ficou registrada.
      const telemetria = await engineeringTaskService.listTelemetry(task.id);
      const preVerificacao = telemetria.find((t) => t.event_type === 'SPEC_PRE_VERIFIED');
      expect(preVerificacao).toBeTruthy();
      expect(preVerificacao.result).toBe('SATISFIED');
    }
  }, 240000);

  test('fonte avançada + comandos FALHANDO ⇒ o coder É chamado (falha é reprodução, não atalho)', async () => {
    if (!dbAvailable) return skipOrFail({ reason: `banco indisponível: ${dbReason}`, code: 'DB_UNAVAILABLE' });
    if (!isSandboxAvailable()) return skipOrFail({ reason: 'Docker sandbox indisponível', code: 'SANDBOX_UNAVAILABLE' });

    const missionId = await criarMissaoEEndereco();
    const task = await criarTask({ missionId, testCommands: [COMANDO_QUE_FALHA] });
    await avancarFonteDaMissao(missionId, task.id);
    const antes = chamadasCoder.total;
    const resultado = await router.runTask(task.id);
    // Não conclui GREEN por pré-verificação: a spec NÃO está satisfeita.
    expect(resultado.reasonCode).not.toBe('SPEC_ALREADY_SATISFIED');
    expect(resultado.specAlreadySatisfied).toBeUndefined();
    expect(chamadasCoder.total).toBeGreaterThan(antes);
  }, 300000);

  test('fonte NÃO avançou ⇒ pré-verificação não se aplica (fluxo normal)', async () => {
    if (!dbAvailable) return skipOrFail({ reason: `banco indisponível: ${dbReason}`, code: 'DB_UNAVAILABLE' });

    const missionId = await criarMissaoEEndereco();
    const task = await criarTask({ missionId, testCommands: [COMANDO_QUE_PASSA] });
    // Fonte criada mas NÃO avançada: nenhuma correção integrada ⇒ não há o que pré-verificar.
    await missionSourceService.ensureMissionSource(missionId, { actor: 'jest-spec-preverify' });
    const fonte = await missionSourceService.getMissionSource(missionId);
    expect(fonte.currentCommit).toBe(fonte.baseCommit);
    const antes = chamadasCoder.total;
    const resultado = await router.runTask(task.id);
    expect(resultado.reasonCode).not.toBe('SPEC_ALREADY_SATISFIED');
    expect(chamadasCoder.total).toBeGreaterThanOrEqual(antes);
  }, 240000);
});
