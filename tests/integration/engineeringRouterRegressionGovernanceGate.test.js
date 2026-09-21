'use strict';

/**
 * ERV1-CLOSE-004 — prova de ORQUESTRAÇÃO (não só a unidade `regressionGovernanceService`):
 * quando a checagem real de GOVERNANCE reprova, a task termina RED, mesmo com CODER/TESTING/
 * REVIEWER todos tendo aprovado. GREEN nunca pode depender só de status — precisa do gate
 * passando de verdade.
 *
 * `regressionGovernanceService` é mockado aqui (jest.doMock, antes de qualquer require) só para
 * forçar a reprovação de verdade de um jeito determinístico — o resto do pipeline (DB real,
 * fakes de provider reais, git worktree real, jest real) roda sem nenhum dublê, exatamente como
 * os outros testes E2E desta suíte.
 */

jest.doMock('../../api/services/engineeringRouter/regressionGovernanceService', () => ({
  checkRegression: jest.fn(),
  checkGovernance: jest.fn(),
}));

// jest.config.cjs tem resetMocks:true — a implementação passada na factory do jest.doMock() é
// limpa antes de CADA teste, então precisa ser reafirmada num beforeEach (mesmo achado real já
// documentado em tests/unit/engineeringModelAvailabilityService.test.js).
const regressionGovernanceServiceMock = require('../../api/services/engineeringRouter/regressionGovernanceService');
beforeEach(() => {
  regressionGovernanceServiceMock.checkRegression.mockResolvedValue({ pass: true, evidence: { checkedAt: new Date().toISOString(), testRunCount: 1 } });
  regressionGovernanceServiceMock.checkGovernance.mockResolvedValue({
    pass: false,
    evidence: { checkedAt: new Date().toISOString(), gate: 'validate-engineering-router-v1', exitCode: 1, summary: ['status=FAIL (simulado para este teste)'] },
  });
});

const sequelizeModule = require('../../api/db/sequelize');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { runTask } = require('../../api/services/engineeringRouter/engineeringRouterService');

const CODER_PROVIDER = 'anthropic';
const REVIEWER_PROVIDER = 'mistral';
const TEST_TENANT_KEY = 'jest-e2e-engineering-router-governance-gate';
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
  console.warn(`[governance-gate-e2e] PULADO: postgres_unreachable (${dbReason})`);
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
    if (tenant) await TenantAICredentialModel.destroy({ where: { tenant_id: tenant.id, provider } });
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
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Governance Gate', status: 'active', plan: 'enterprise' },
  });

  await setupCredential(TEST_TENANT_KEY, CODER_PROVIDER);
  await setupCredential(TEST_TENANT_KEY, REVIEWER_PROVIDER);

  function makeFakeProvider(label) {
    return {
      async generate(prompt, context) {
        if (context.purpose === 'engineering_coder') {
          return { text: JSON.stringify({ summary: 'adiciona add', diff: FIX_DIFF }), usage: { prompt_tokens: 1, completion_tokens: 1 } };
        }
        if (context.purpose === 'engineering_reviewer') {
          return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 1, completion_tokens: 1 } };
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
  await teardownCredential(TEST_TENANT_KEY, CODER_PROVIDER);
  await teardownCredential(TEST_TENANT_KEY, REVIEWER_PROVIDER);
  try {
    const TenantModel = getModels.getTenant();
    await TenantModel.destroy({ where: { tenant_key: TEST_TENANT_KEY } });
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
  jest.dontMock('../../api/services/engineeringRouter/regressionGovernanceService');
}, 30000);

describe('ERV1-CLOSE-004 — GOVERNANCE reprovando termina a task em RED, nunca GREEN decorativo', () => {
  jest.setTimeout(60000);

  test('CODER/TESTING/REVIEWER todos aprovam, mas GOVERNANCE real reprova → task RED', async () => {
    if (skipIfNoDatabase()) return;

    const task = await engineeringTaskService.createTask({
      title: 'jest-governance-gate: adicionar add() em mathUtils',
      objective: 'A função add() precisa existir e somar dois números corretamente.',
      taskType: 'BUG_FIX',
      risk: 'LOW',
      allowedPaths: [FIXTURE_FILE],
      testCommands: [FIXTURE_TEST_COMMAND],
      maxIterations: 1,
    }, { createdBy: 'jest-governance-gate' });
    createdTaskIds.push(task.id);

    const result = await runTask(task.id, { runnerId: 'jest-governance-gate-runner', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });

    // GOVERNANCE mockado para reprovar — mesmo com o restante do pipeline real aprovando tudo,
    // a task NUNCA pode chegar em GREEN.
    expect(result.status).toBe('RED');
    expect(result.reasonCode).toBe('GOVERNANCE_FAILED');

    const finalTask = await engineeringTaskService.getTask(task.id);
    expect(finalTask.status).toBe('RED');
    expect(finalTask.last_error.code).toBe('GOVERNANCE_FAILED');

    // O attempt real mostra que CODER/TESTING/REVIEWER passaram de verdade — só GOVERNANCE
    // barrou, prova de que a checagem é real e específica, não um bloqueio genérico.
    const attempts = await engineeringTaskService.listAttempts(task.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].patch_diff).toBe(FIX_DIFF);
    expect(attempts[0].regression_evidence).toBeTruthy();
    expect(attempts[0].governance_evidence).toBeTruthy();
    expect(attempts[0].governance_evidence.exitCode).toBe(1);

    const reviews = await engineeringTaskService.listReviews(attempts[0].id);
    expect(reviews[0].decision).toBe('APPROVE');
  });
});
