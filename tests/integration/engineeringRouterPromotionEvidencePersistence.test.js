'use strict';

/**
 * Achado real ao validar a tela de detalhe da task no BROWSER (Playwright, tenant real,
 * task real do pilot): a página nunca exibia nenhuma informação de promoção — investigando o
 * porquê, `promotionResult.code` (o motivo exato de uma promoção que não completou, ex.:
 * `PROMOTION_TARGET_DIVERGED`) nunca era mesclado em `promotion_evidence` antes de persistir no
 * attempt — só existia no evento WebSocket ao vivo (`emitTaskStage`) e no valor de retorno da
 * função. Quem abrisse a tela DEPOIS da execução via READY_FOR_PROMOTION sem nenhum motivo.
 *
 * Este teste mocka `promotionService.createPromotionCandidate` (ER-V1-SEAL-002 dividiu
 * `promoteValidatedPatch` em `createPromotionCandidate` + `verifyPromotedCandidate` — a lógica
 * de promoção em si já tem cobertura real e completa em `engineeringPromotionService.test.js` e
 * `engineeringPromotionCandidateSplit.test.js`, inclusive o cenário real de target divergido,
 * que aqueles testes evitam reproduzir aqui mudando o HEAD real do repo compartilhado) para
 * isolar e provar especificamente a PERSISTÊNCIA: quando a promoção não completa, o `code`
 * precisa sobreviver no banco, não só no evento efêmero.
 */

jest.mock('../../api/services/engineeringRouter/promotionService', () => ({
  createPromotionCandidate: jest.fn(),
  verifyPromotedCandidate: jest.fn(),
  findExistingCandidate: jest.fn().mockResolvedValue({ found: false }),
  computeValidatedPatchHash: jest.fn((diff) => require('crypto').createHash('sha256').update(String(diff || '')).digest('hex')),
  candidateBranchName: jest.fn((taskId) => `engineering-router/candidates/${taskId}`),
}));

const sequelizeModule = require('../../api/db/sequelize');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { runTask } = require('../../api/services/engineeringRouter/engineeringRouterService');
const { createPromotionCandidate } = require('../../api/services/engineeringRouter/promotionService');

const CODER_PROVIDER = 'anthropic';
const REVIEWER_PROVIDER = 'mistral';
const TEST_TENANT_KEY = 'jest-e2e-promotion-evidence-persistence';

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
  console.warn(`[promotion-evidence-persistence] PULADO: postgres_unreachable (${dbReason})`);
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
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest — Promotion Evidence Persistence', status: 'active', plan: 'enterprise' },
  });

  await setupCredential(TEST_TENANT_KEY, CODER_PROVIDER);
  await setupCredential(TEST_TENANT_KEY, REVIEWER_PROVIDER);

  registerAiProvider(CODER_PROVIDER, {
    async generate(prompt, context) {
      if (context.purpose === 'engineering_coder') {
        return { text: JSON.stringify({ summary: 'adiciona add', diff: FIX_DIFF }), usage: { prompt_tokens: 1, completion_tokens: 1 } };
      }
      throw new Error(`purpose inesperado: ${context.purpose}`);
    },
  });
  registerAiProvider(REVIEWER_PROVIDER, {
    async generate(prompt, context) {
      if (context.purpose === 'engineering_reviewer') {
        return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: {} };
      }
      throw new Error(`purpose inesperado: ${context.purpose}`);
    },
  });
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
}, 30000);

describe('engineeringRouterService — persistência da evidência de promoção não completada', () => {
  // ER-V1-FINAL-009: 60s não é margem suficiente quando createWorkspace precisa reexecutar o
  // retry do TOCTOU real de `git add -A` (patchApplyService.js) sob a suíte completa rodando em
  // paralelo — reproduzido ao vivo (timeout, não falha de lógica). Mesma causa do ajuste em
  // engineeringRouterOrphanWorkspacePruning.test.js.
  jest.setTimeout(120000);

  test('quando a promoção não completa, o code (motivo exato) sobrevive em promotion_evidence, não só no evento efêmero', async () => {
    if (skipIfNoDatabase()) return;

    createPromotionCandidate.mockResolvedValue({
      created: false,
      code: 'PROMOTION_TARGET_DIVERGED',
      evidence: { promotionAttemptedAt: new Date().toISOString(), baselineHead: 'aaa111', targetHead: 'bbb222', validatedPatchHash: 'fake-hash' },
    });

    const task = await engineeringTaskService.createTask({
      title: 'jest-promotion-evidence-persistence',
      objective: 'A função add() precisa existir e somar dois números corretamente.',
      taskType: 'BUG_FIX',
      // HIGH força independência de provider entre CODER (anthropic) e REVIEWER (mistral) —
      // sem isso, o Router pode legitimamente reaproveitar o provider mais barato para os dois
      // papéis, e o fake registrado sob REVIEWER_PROVIDER nunca seria chamado (mesma armadilha
      // documentada em engineeringRouterReviewerRejectionRecodeE2E.test.js).
      risk: 'HIGH',
      allowedPaths: [FIXTURE_FILE],
      testCommands: [FIXTURE_TEST_COMMAND],
      maxIterations: 2,
    }, { createdBy: 'jest-promotion-evidence-persistence' });
    createdTaskIds.push(task.id);

    const result = await runTask(task.id, { runnerId: 'jest-promotion-evidence-runner', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });

    expect(result.status).toBe('READY_FOR_PROMOTION');
    expect(result.reasonCode).toBe('PROMOTION_TARGET_DIVERGED');

    const attempts = await engineeringTaskService.listAttempts(task.id);
    expect(attempts).toHaveLength(1);
    // A prova real: o motivo sobrevive no banco, disponível para qualquer leitura futura da
    // tela (não só durante a execução ao vivo via WebSocket).
    expect(attempts[0].promotion_status).toBe('READY_FOR_PROMOTION');
    expect(attempts[0].promotion_evidence.code).toBe('PROMOTION_TARGET_DIVERGED');
    expect(attempts[0].promotion_evidence.baselineHead).toBe('aaa111');

    const finalTask = await engineeringTaskService.getTask(task.id);
    expect(finalTask.status).toBe('READY_FOR_PROMOTION');
  });
});
