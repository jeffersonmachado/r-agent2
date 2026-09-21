'use strict';

/**
 * ERV1-CLOSE-008 — reroute real de modelo dentro da MESMA EngineeringTask.
 *
 * Achado real (pilot desta missão): provider saudável (circuit breaker fechado) não implica
 * modelId válido — `openai:gpt-5.5-pro`/`openai:gpt-5-codex` retornaram 404 real enquanto
 * `openai` em si funcionava perfeitamente para outros modelos. Antes desta correção, uma falha
 * `PROVIDER_UNAVAILABLE` do CODER/REVIEWER ia direto para `FATAL`/`RED` — a task inteira era
 * descartada mesmo havendo outro modelo qualificado disponível.
 *
 * Este teste registra um provider REAL do registry (`anthropic`) cujo fake SEMPRE falha com um
 * erro 404 real (simulando um modelo retirado), e outro (`mistral`) que funciona — prova, com
 * toda a infraestrutura real (DB, git worktree, jest real), que o Router:
 *   1. tenta os modelos `anthropic` mais baratos primeiro (ordem real de custo);
 *   2. marca cada um como indisponível ao falhar e reroteia para o próximo candidato, sem sair
 *      da mesma task (mesmo `taskId`, histórico de tentativas mostra o reroute);
 *   3. eventualmente chega em `mistral` (o único candidato saudável restante) e completa GREEN.
 */

const sequelizeModule = require('../../api/db/sequelize');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { runTask } = require('../../api/services/engineeringRouter/engineeringRouterService');
const modelAvailabilityStore = require('../../api/services/engineeringRouter/modelAvailabilityStore');

const BROKEN_PROVIDER = 'anthropic'; // 3 modelos CODER-qualificados para BUG_FIX, todos vão falhar
const WORKING_PROVIDER = 'mistral'; // único candidato saudável restante
const TEST_TENANT_KEY = 'jest-e2e-engineering-router-reroute';

const FIXTURE_FILE = 'tests/fixtures/engineering-router-sandbox/mathUtils.js';
const FIXTURE_TEST_COMMAND = 'npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=tests/fixtures/engineering-router-sandbox/mathUtils.test.js --no-coverage';

const FIX_DIFF = `diff --git a/${FIXTURE_FILE} b/${FIXTURE_FILE}
--- a/${FIXTURE_FILE}
+++ b/${FIXTURE_FILE}
@@ -1,7 +1,11 @@
 'use strict';

 function multiply(a, b) {
   return a * b;
 }

-module.exports = { multiply };
+function add(a, b) {
+  return a + b;
+}
+
+module.exports = { multiply, add };
`;

let dbAvailable = false;
let dbReason = null;
const createdTaskIds = [];

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[engineering-router-reroute-e2e] PULADO: postgres_unreachable (${dbReason})`);
  return true;
}

async function setupCredential(tenantKey, provider) {
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  await saveAICredentials(tenantKey, provider, `jest-fixture-fake-key-${provider}-${Date.now()}`);
}

// ERV1-CLOSE-005: GREEN real cria uma branch local real (engineering-router/candidates/
// <taskId>) — limpeza de teste, nunca deve sobrar depois deste arquivo.
function deleteCandidateBranchIfExists(taskId) {
  try {
    const { execFileSync } = require('child_process');
    execFileSync('git', ['branch', '-D', `engineering-router/candidates/${taskId}`], {
      cwd: require('path').resolve(__dirname, '..', '..'),
      stdio: 'ignore',
    });
  } catch (_) { /* branch pode não ter sido criada */ }
}

async function teardownCredential(tenantKey, provider) {
  try {
    const getModels = require('../../api/db/models');
    const TenantModel = getModels.getTenant();
    const TenantAICredentialModel = getModels.getTenantAICredential();
    const tenant = await TenantModel.findOne({ where: { tenant_key: tenantKey } });
    if (tenant) {
      await TenantAICredentialModel.destroy({ where: { tenant_id: tenant.id, provider } });
    }
  } catch (_) { /* best-effort */ }
}

beforeAll(async () => {
  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
    return;
  }

  const getModels = require('../../api/db/models');
  const TenantModel = getModels.getTenant();
  await TenantModel.findOrCreate({
    where: { tenant_key: TEST_TENANT_KEY },
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Reroute', status: 'active', plan: 'enterprise' },
  });

  await setupCredential(TEST_TENANT_KEY, BROKEN_PROVIDER);
  await setupCredential(TEST_TENANT_KEY, WORKING_PROVIDER);

  registerAiProvider(BROKEN_PROVIDER, {
    async generate() {
      const err = new Error(`${BROKEN_PROVIDER}: this is not a chat model (simulated 404 real do pilot)`);
      err.code = require('../../engine/engineeringRouter/constants').FAILURE_CODES.PROVIDER_UNAVAILABLE;
      err.httpStatus = 404;
      throw err;
    },
  });

  registerAiProvider(WORKING_PROVIDER, {
    async generate(prompt, context) {
      if (context.purpose === 'engineering_coder') {
        return { text: JSON.stringify({ summary: 'adiciona função add em mathUtils', diff: FIX_DIFF }), usage: { prompt_tokens: 120, completion_tokens: 60 } };
      }
      if (context.purpose === 'engineering_reviewer') {
        return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 80, completion_tokens: 20 } };
      }
      throw new Error(`[${WORKING_PROVIDER}] purpose inesperado: ${context.purpose}`);
    },
  });
}, 30000);

afterAll(async () => {
  if (!dbAvailable) return;
  clearAiProviderConfig();
  modelAvailabilityStore._clearAllForTests();
  const getModels = require('../../api/db/models');
  try {
    for (const taskId of createdTaskIds) {
      deleteCandidateBranchIfExists(taskId);
      const attempts = await engineeringTaskService.listAttempts(taskId);
      for (const attempt of attempts) {
        const TestRun = getModels.getEngineeringTestRun();
        const Review = getModels.getEngineeringReview();
        await TestRun.destroy({ where: { attempt_id: attempt.id } });
        await Review.destroy({ where: { attempt_id: attempt.id } });
      }
      const Attempt = getModels.getEngineeringAttempt();
      const Telemetry = getModels.getEngineeringTelemetryEvent();
      await Attempt.destroy({ where: { task_id: taskId } });
      await Telemetry.destroy({ where: { task_id: taskId } });
      const Task = getModels.getEngineeringTask();
      await Task.destroy({ where: { id: taskId } });
    }
  } catch (_) { /* best-effort */ }

  await teardownCredential(TEST_TENANT_KEY, BROKEN_PROVIDER);
  await teardownCredential(TEST_TENANT_KEY, WORKING_PROVIDER);
  try {
    const TenantModel = getModels.getTenant();
    await TenantModel.destroy({ where: { tenant_key: TEST_TENANT_KEY } });
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('ERV1-CLOSE-008 — reroute real de modelo indisponível dentro da mesma task', () => {
  jest.setTimeout(60000);

  test('CODER indisponível (404 real) é reroteado para o próximo candidato até chegar em GREEN', async () => {
    if (skipIfNoDatabase()) return;

    const task = await engineeringTaskService.createTask({
      title: 'jest-reroute-e2e: adicionar add() em mathUtils',
      objective: 'A função add() precisa existir e somar dois números corretamente.',
      taskType: 'BUG_FIX',
      risk: 'LOW', // sem independência exigida — simplifica para 2 providers só
      allowedPaths: [FIXTURE_FILE],
      testCommands: [FIXTURE_TEST_COMMAND],
      // anthropic tem 3 modelos CODER-qualificados (haiku/sonnet/opus) — todos vão falhar antes
      // de chegar em mistral. Precisa de iterações suficientes para os 3 reroutes + o attempt
      // que finalmente funciona.
      maxIterations: 6,
    }, { createdBy: 'jest-reroute-e2e' });
    createdTaskIds.push(task.id);

    const result = await runTask(task.id, { runnerId: 'jest-reroute-e2e-runner', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });

    expect(result.status).toBe('GREEN');

    const finalTask = await engineeringTaskService.getTask(task.id);
    expect(finalTask.status).toBe('GREEN');

    // A ROTA REAL: routing_decision final aponta para o provider que funciona, não o quebrado.
    expect(finalTask.routing_decision.coder.selected.providerId).toBe(WORKING_PROVIDER);

    // Histórico de tentativas mostra os reroutes reais: pelo menos uma tentativa com o provider
    // quebrado (falhou de verdade) e a tentativa final com o provider que funciona (GREEN).
    const attempts = await engineeringTaskService.listAttempts(task.id);
    expect(attempts.length).toBeGreaterThan(1);
    expect(attempts.some((a) => a.coder_provider === BROKEN_PROVIDER)).toBe(true);
    const lastAttempt = attempts[attempts.length - 1];
    expect(lastAttempt.coder_provider).toBe(WORKING_PROVIDER);
    expect(lastAttempt.status).toBe('DONE');
    expect(lastAttempt.patch_diff).toBe(FIX_DIFF);

    // Todos os modelos do provider quebrado foram marcados indisponíveis de verdade (prova real
    // de que o classificador de falha + o store de disponibilidade rodaram, não só a policy).
    const brokenAvailability = modelAvailabilityStore.getAvailability(BROKEN_PROVIDER, 'claude-haiku-4-5-20251001');
    expect(brokenAvailability.availability).not.toBe('AVAILABLE');
    expect(brokenAvailability.availability).not.toBe('UNKNOWN');
  });
});
