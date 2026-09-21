'use strict';

/**
 * E2E do Engineering Model Router V1 — ponta a ponta REAL:
 *
 *   EngineeringTask (BUG_FIX) → CLASSIFY → ROUTE (seleção real de CODER/REVIEWER via
 *   capability fit + credencial real) → CONTEXT → CODE (patch real) → PATCH VALIDATE →
 *   CONTROLLED APPLY (git worktree isolado) → DETERMINISTIC TEST (RED confirmado, depois
 *   GREEN após o patch) → INDEPENDENT REVIEW (APPROVE) → REGRESSION → GOVERNANCE → GREEN.
 *
 * Único ponto substituído por um dublê: a chamada de rede ao LLM (`provider.generate`) — via
 * `registerAiProvider` REAL sob um id de provider REAL do registry (`anthropic`, `mistral`),
 * exatamente como a missão instrui ("o fake deve respeitar EXATAMENTE o contrato real").
 * Credencial é uma linha real em `tenant_ai_credentials` (tenant 'system'), removida no
 * teardown. Tudo o mais — classifier, policy, seleção de modelo, path boundary, patch
 * validator, git worktree, test runner, reviewer parsing, state machine, persistência — roda
 * sem nenhum dublê.
 *
 * Banco indisponível ⇒ pulo EXPLÍCITO (nunca verde silencioso).
 */

const sequelizeModule = require('../../api/db/sequelize');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { runTask } = require('../../api/services/engineeringRouter/engineeringRouterService');

const CODER_PROVIDER = 'anthropic';
const REVIEWER_PROVIDER = 'mistral';

const FIXTURE_FILE = 'tests/fixtures/engineering-router-sandbox/mathUtils.js';
const FIXTURE_TEST_COMMAND = "npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern=tests/fixtures/engineering-router-sandbox/mathUtils.test.js --no-coverage";

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
  console.warn(`[engineering-router-e2e] PULADO: postgres_unreachable (${dbReason})`);
  return true;
}

async function setupCredential(tenantKey, provider) {
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  await saveAICredentials(tenantKey, provider, `jest-fixture-fake-key-${provider}-${Date.now()}`);
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

  await setupCredential('system', CODER_PROVIDER);
  await setupCredential('system', REVIEWER_PROVIDER);

  // Um provider real responde de acordo com o prompt recebido — inclusive quando o MESMO
  // provider é qualificado tanto para CODER quanto para REVIEWER (independência de provider só
  // é exigida pela policy para risco HIGH/CRITICAL; risk LOW pode legitimamente reaproveitar o
  // provider mais barato para os dois papéis). O fake precisa refletir isso via
  // `context.purpose`, senão não respeita o contrato real de um provider que atende os dois
  // papéis.
  function makeFakeProvider(label) {
    return {
      async generate(prompt, context) {
        expect(context.tenantId).toBe('system');
        if (context.purpose === 'engineering_coder') {
          return {
            text: JSON.stringify({ summary: 'adiciona função add em mathUtils', diff: FIX_DIFF }),
            usage: { prompt_tokens: 120, completion_tokens: 60 },
          };
        }
        if (context.purpose === 'engineering_reviewer') {
          return {
            text: JSON.stringify({ decision: 'APPROVE', findings: [] }),
            usage: { prompt_tokens: 80, completion_tokens: 20 },
          };
        }
        throw new Error(`[${label}] purpose inesperado: ${context.purpose}`);
      },
    };
  }

  registerAiProvider(CODER_PROVIDER, makeFakeProvider(CODER_PROVIDER));
  registerAiProvider(REVIEWER_PROVIDER, makeFakeProvider(REVIEWER_PROVIDER));
}, 30000);

afterAll(async () => {
  if (!dbAvailable) return;
  clearAiProviderConfig();
  const getModels = require('../../api/db/models');
  try {
    for (const taskId of createdTaskIds) {
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

  await teardownCredential('system', CODER_PROVIDER);
  await teardownCredential('system', REVIEWER_PROVIDER);
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('Engineering Model Router V1 — E2E RED → FIX → REVIEW → GREEN', () => {
  jest.setTimeout(60000);

  test('confirma RED antes do patch (fixture real, sem nenhum dublê de teste)', async () => {
    if (skipIfNoDatabase()) return;
    const { spawnSync } = require('child_process');
    const result = spawnSync('npx', ['jest', '--testPathIgnorePatterns=/node_modules/', '--testPathPattern=tests/fixtures/engineering-router-sandbox/mathUtils.test.js', '--no-coverage'], {
      cwd: require('path').resolve(__dirname, '..', '..'),
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
  });

  test('task BUG_FIX completa o loop real e chega a GREEN', async () => {
    if (skipIfNoDatabase()) return;

    const task = await engineeringTaskService.createTask({
      title: 'jest-fixture-e2e: adicionar add() em mathUtils',
      objective: 'A função add() precisa existir e somar dois números corretamente.',
      taskType: 'BUG_FIX',
      // HIGH força independência de provider entre CODER e REVIEWER (regra real da policy) —
      // exercita também essa parte do Router, não só o caminho feliz sem independência.
      risk: 'HIGH',
      allowedPaths: [FIXTURE_FILE],
      testCommands: [FIXTURE_TEST_COMMAND],
      maxIterations: 2,
    }, { createdBy: 'jest-e2e' });
    createdTaskIds.push(task.id);

    const result = await runTask(task.id, { runnerId: 'jest-e2e-runner' });

    expect(result.status).toBe('GREEN');

    const finalTask = await engineeringTaskService.getTask(task.id);
    expect(finalTask.status).toBe('GREEN');
    expect(finalTask.locked_at).toBeNull();

    const attempts = await engineeringTaskService.listAttempts(task.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].coder_provider).toBe(CODER_PROVIDER);
    expect(attempts[0].status).toBe('DONE');
    expect(attempts[0].patch_diff).toBe(FIX_DIFF);

    const testRuns = await engineeringTaskService.listTestRuns(attempts[0].id);
    expect(testRuns).toHaveLength(1);
    expect(testRuns[0].status).toBe('PASS');
    expect(testRuns[0].exit_code).toBe(0);

    const reviews = await engineeringTaskService.listReviews(attempts[0].id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].decision).toBe('APPROVE');
    expect(reviews[0].reviewer_provider).toBe(REVIEWER_PROVIDER);

    const telemetry = await engineeringTaskService.listTelemetry(task.id);
    expect(telemetry.length).toBeGreaterThanOrEqual(2);
    expect(telemetry.some((t) => t.role === 'CODER' && t.result === 'SUCCESS')).toBe(true);
    expect(telemetry.some((t) => t.role === 'REVIEWER' && t.result === 'SUCCESS')).toBe(true);
  });

  test('confirma que o working tree principal NUNCA foi alterado pelo patch', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(path.resolve(__dirname, '..', '..', FIXTURE_FILE), 'utf8');
    expect(content).not.toContain('function add');
  });
});
