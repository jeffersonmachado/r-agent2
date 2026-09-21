'use strict';

/**
 * ERV1-CLOSE-010 — Runtime certification exige evidência REAL do item "reviewer
 * rejection→recode", não apenas a checagem estrutural de que o código CONTÉM
 * `decision === 'REJECT'`. Achado real ao levantar o inventário de evidências de runtime:
 * nenhum teste do repositório exercitava, ponta a ponta, o loop real que a missão exige —
 * REVIEWER rejeita a 1ª tentativa (findings BLOCKER) → task volta para uma nova tentativa de
 * CODING com o failureBundle do reviewer → CODER gera um novo patch → REVIEWER aprova a 2ª
 * tentativa → GREEN. `engineeringCoderReviewerService.test.js` só provava o parsing da decisão
 * REJECT isoladamente; nenhum teste provava que a task inteira reage a isso com uma nova
 * tentativa real (persistida) em vez de travar/RED.
 *
 * Mesmo padrão do `engineeringRouterFullLoopE2E.test.js`: único dublê é a chamada de rede ao
 * LLM, sob um provider real do registry, tenant dedicado (nunca `system`), banco Postgres real.
 */

const sequelizeModule = require('../../api/db/sequelize');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { runTask } = require('../../api/services/engineeringRouter/engineeringRouterService');

const CODER_PROVIDER = 'anthropic';
const REVIEWER_PROVIDER = 'mistral';
const TEST_TENANT_KEY = 'jest-e2e-engineering-router-reject-recode';

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
  console.warn(`[engineering-router-reject-recode] PULADO: postgres_unreachable (${dbReason})`);
  return true;
}

async function setupCredential(tenantKey, provider) {
  const { saveAICredentials } = require('../../api/services/tenantAIService');
  await saveAICredentials(tenantKey, provider, `jest-fixture-fake-key-${provider}-${Date.now()}`);
}

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
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Reviewer Reject Recode', status: 'active', plan: 'enterprise' },
  });

  await setupCredential(TEST_TENANT_KEY, CODER_PROVIDER);
  await setupCredential(TEST_TENANT_KEY, REVIEWER_PROVIDER);

  let reviewerCallCount = 0;

  registerAiProvider(CODER_PROVIDER, {
    async generate(prompt, context) {
      expect(context.tenantId).toBe(TEST_TENANT_KEY);
      if (context.purpose === 'engineering_coder') {
        return {
          text: JSON.stringify({ summary: 'adiciona função add em mathUtils', diff: FIX_DIFF }),
          usage: { prompt_tokens: 120, completion_tokens: 60 },
        };
      }
      throw new Error(`[coder] purpose inesperado: ${context.purpose}`);
    },
  });

  // A 1ª chamada do reviewer REJEITA com um finding BLOCKER real (força RETRY/recode); a 2ª
  // chamada (2ª tentativa, depois do CODER "recodificar") APROVA — prova o loop completo, não
  // só o parsing isolado da decisão.
  registerAiProvider(REVIEWER_PROVIDER, {
    async generate(prompt, context) {
      expect(context.tenantId).toBe(TEST_TENANT_KEY);
      if (context.purpose !== 'engineering_reviewer') {
        throw new Error(`[reviewer] purpose inesperado: ${context.purpose}`);
      }
      reviewerCallCount += 1;
      if (reviewerCallCount === 1) {
        return {
          text: JSON.stringify({
            decision: 'REJECT',
            findings: [{ severity: 'BLOCKER', category: 'correctness', description: 'add() precisa validar tipos numéricos', file: FIXTURE_FILE, line: 8, releaseBlocking: true, evidence: 'ausência de validação' }],
          }),
          usage: { prompt_tokens: 80, completion_tokens: 30 },
        };
      }
      return {
        text: JSON.stringify({ decision: 'APPROVE', findings: [] }),
        usage: { prompt_tokens: 80, completion_tokens: 20 },
      };
    },
  });
}, 30000);

afterAll(async () => {
  if (!dbAvailable) return;
  clearAiProviderConfig();
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

  await teardownCredential(TEST_TENANT_KEY, CODER_PROVIDER);
  await teardownCredential(TEST_TENANT_KEY, REVIEWER_PROVIDER);
  try {
    const TenantModel = getModels.getTenant();
    await TenantModel.destroy({ where: { tenant_key: TEST_TENANT_KEY } });
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('ERV1-CLOSE-010 — reviewer REJECT força recode real (nunca RED direto, nunca ignora o reviewer)', () => {
  jest.setTimeout(60000);

  test('1ª tentativa é rejeitada pelo reviewer (BLOCKER) → 2ª tentativa real é criada e aprovada → GREEN', async () => {
    if (skipIfNoDatabase()) return;

    const task = await engineeringTaskService.createTask({
      title: 'jest-fixture-reject-recode: adicionar add() em mathUtils',
      objective: 'A função add() precisa existir e somar dois números corretamente.',
      taskType: 'BUG_FIX',
      // HIGH força independência de provider entre CODER e REVIEWER (mesma razão do
      // engineeringRouterFullLoopE2E.test.js) — sem isso, o Router pode legitimamente rotear o
      // papel de REVIEWER para o próprio provider mais barato do CODER, e o fake registrado sob
      // REVIEWER_PROVIDER nunca seria chamado.
      risk: 'HIGH',
      allowedPaths: [FIXTURE_FILE],
      testCommands: [FIXTURE_TEST_COMMAND],
      maxIterations: 3,
    }, { createdBy: 'jest-e2e-reject-recode' });
    createdTaskIds.push(task.id);

    const result = await runTask(task.id, { runnerId: 'jest-e2e-reject-recode-runner', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });

    expect(result.status).toBe('GREEN');

    // Prova o "recode" real: DUAS tentativas persistidas, não uma — a 1ª FAILED-por-review, a
    // 2ª DONE. Nunca finge que uma REJECT não aconteceu.
    const attempts = await engineeringTaskService.listAttempts(task.id);
    expect(attempts).toHaveLength(2);

    const [firstAttempt, secondAttempt] = attempts.sort((a, b) => a.attempt_number - b.attempt_number);
    expect(firstAttempt.status).toBe('FAILED');
    expect(secondAttempt.status).toBe('DONE');

    // A 2ª tentativa recebeu o failureBundle real do reviewer da 1ª (o "recode" tem contexto do
    // motivo da rejeição — nunca gera de novo do zero sem saber por que falhou).
    expect(secondAttempt.failure_bundle?.failedCommand).toBe('REVIEW');
    expect(secondAttempt.failure_bundle?.findings?.[0]?.severity).toBe('BLOCKER');

    const firstReviews = await engineeringTaskService.listReviews(firstAttempt.id);
    expect(firstReviews).toHaveLength(1);
    expect(firstReviews[0].decision).toBe('REJECT');

    const secondReviews = await engineeringTaskService.listReviews(secondAttempt.id);
    expect(secondReviews).toHaveLength(1);
    expect(secondReviews[0].decision).toBe('APPROVE');

    const finalTask = await engineeringTaskService.getTask(task.id);
    expect(finalTask.status).toBe('GREEN');
    expect(finalTask.locked_at).toBeNull();
  });
});
