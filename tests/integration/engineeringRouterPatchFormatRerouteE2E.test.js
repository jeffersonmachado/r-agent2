'use strict';

/**
 * HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07) — reroute controlado por falha de FORMATO de patch.
 *
 * Achado real medido antes desta correção: o CODER `qwen:qwen3-coder-flash` emitiu 10/10 patches
 * com CABEÇALHO correto e CORPO de hunk SEM prefixo. O validador estrutural aceitava, o
 * `git apply --check` recusava (`error: patch corrompido na linha 7`) e `PATCH_APPLY_FAILED` NÃO
 * reroteava — as 6 iterações eram gastas no MESMO modelo reproduzindo o mesmo defeito (2 tasks RED,
 * 12 tentativas, nenhum veredito sobre o mérito do código).
 *
 * Este teste prova, com a infraestrutura REAL (DB, git worktree, jest, promoção):
 *   1. patch com corpo sem prefixo é REJEITADO antes de qualquer `git apply`, com código próprio
 *      (`PATCH_BODY_MISSING_PREFIX`) — nunca reparado;
 *   2. a repetição do defeito no mesmo modelo dispara reroute CONTROLADO para outro provider;
 *   3. o provider seguinte assume e a task chega em GREEN;
 *   4. a telemetria preserva a cadeia de decisão (provider/modelo/falha/arquivo/hunk/reroute);
 *   5. os orçamentos (maxIterations + orçamento da cadeia de providers) impedem loop infinito —
 *      a task termina em estado terminal honesto em vez de repetir o mesmo modelo para sempre.
 */

const sequelizeModule = require('../../api/db/sequelize');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { runTask } = require('../../api/services/engineeringRouter/engineeringRouterService');
const modelAvailabilityStore = require('../../api/services/engineeringRouter/modelAvailabilityStore');

const BROKEN_PROVIDER = 'anthropic'; // CODER que SEMPRE devolve corpo de hunk sem prefixo
const WORKING_PROVIDER = 'mistral'; // CODER que devolve um unified diff aplicável
const QUOTA_PROVIDER = 'openai'; // CODER que SEMPRE responde 429 sem crédito (2 modelos qualificados)
const TEST_TENANT_KEY = 'jest-e2e-engineering-patch-format-reroute';
const TEST_TENANT_KEY_NO_ALTERNATIVE = 'jest-e2e-engineering-patch-format-budget';
const TEST_TENANT_KEY_QUOTA = 'jest-e2e-engineering-patch-format-quota';

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

/**
 * O MESMO patch, com o MESMO cabeçalho, mas com o CORPO inteiramente sem prefixo — exatamente a
 * forma medida no provider real (linha 7 do patch = primeira linha do corpo). Nada de sintético:
 * é o defeito real persistido em `EngineeringAttempt.patch_diff`.
 */
const BARE_BODY_DIFF = `diff --git a/${FIXTURE_FILE} b/${FIXTURE_FILE}
--- a/${FIXTURE_FILE}
+++ b/${FIXTURE_FILE}
@@ -1,7 +1,11 @@
'use strict';

function multiply(a, b) {
  return a * b;
}

module.exports = { multiply };

function add(a, b) {
  return a + b;
}

module.exports = { multiply, add };
`;

let dbAvailable = false;
let dbReason = null;
const createdTaskIds = [];
const previousRerouteAfter = process.env.ENGINEERING_PATCH_APPLY_REROUTE_AFTER;

function skipIfNoDatabase() {
  if (dbAvailable) return false;
  console.warn(`[engineering-patch-format-reroute-e2e] PULADO: postgres_unreachable (${dbReason})`);
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

async function ensureTenant(tenantKey, label) {
  const getModels = require('../../api/db/models');
  const TenantModel = getModels.getTenant();
  await TenantModel.findOrCreate({
    where: { tenant_key: tenantKey },
    defaults: { tenant_key: tenantKey, name: label, status: 'active', plan: 'enterprise' },
  });
}

beforeAll(async () => {
  // Limiar 1: uma única reprodução do defeito já autoriza reroute (mantém o teste curto; o default
  // de produção é 2 — e o próprio valor é lido a cada avaliação, nunca capturado em load).
  process.env.ENGINEERING_PATCH_APPLY_REROUTE_AFTER = '1';

  try {
    await sequelizeModule.connect(2, 250);
    dbAvailable = true;
  } catch (error) {
    dbAvailable = false;
    dbReason = error.message;
    return;
  }

  await ensureTenant(TEST_TENANT_KEY, 'Jest E2E — Patch Format Reroute');
  await ensureTenant(TEST_TENANT_KEY_NO_ALTERNATIVE, 'Jest E2E — Patch Format Budget');
  await ensureTenant(TEST_TENANT_KEY_QUOTA, 'Jest E2E — Provider Quota Progression');

  await setupCredential(TEST_TENANT_KEY, BROKEN_PROVIDER);
  await setupCredential(TEST_TENANT_KEY, WORKING_PROVIDER);

  await setupCredential(TEST_TENANT_KEY_NO_ALTERNATIVE, BROKEN_PROVIDER);

  // Par (quota + saudável) para provar progression SEM retry inútil do mesmo modelo.
  await setupCredential(TEST_TENANT_KEY_QUOTA, QUOTA_PROVIDER);
  await setupCredential(TEST_TENANT_KEY_QUOTA, WORKING_PROVIDER);

  registerAiProvider(QUOTA_PROVIDER, {
    async generate(prompt, context) {
      if (context.purpose === 'engineering_coder') {
        const err = new Error('429 You have no credits remaining. Add credits to continue using the API.');
        err.status = 429;
        err.code = 'insufficient_quota';
        throw err;
      }
      if (context.purpose === 'engineering_reviewer') {
        return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 80, completion_tokens: 20 } };
      }
      throw new Error(`[${QUOTA_PROVIDER}] purpose inesperado: ${context.purpose}`);
    },
  });

  registerAiProvider(BROKEN_PROVIDER, {
    async generate(prompt, context) {
      if (context.purpose === 'engineering_coder') {
        return { text: JSON.stringify({ summary: 'patch com corpo sem prefixo (defeito real)', diff: BARE_BODY_DIFF }), usage: { prompt_tokens: 120, completion_tokens: 60 } };
      }
      if (context.purpose === 'engineering_reviewer') {
        return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 80, completion_tokens: 20 } };
      }
      throw new Error(`[${BROKEN_PROVIDER}] purpose inesperado: ${context.purpose}`);
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
  if (previousRerouteAfter === undefined) delete process.env.ENGINEERING_PATCH_APPLY_REROUTE_AFTER;
  else process.env.ENGINEERING_PATCH_APPLY_REROUTE_AFTER = previousRerouteAfter;

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

  for (const [tenantKey, providers] of [
    [TEST_TENANT_KEY, [BROKEN_PROVIDER, WORKING_PROVIDER]],
    [TEST_TENANT_KEY_NO_ALTERNATIVE, [BROKEN_PROVIDER]],
    [TEST_TENANT_KEY_QUOTA, [QUOTA_PROVIDER, WORKING_PROVIDER]],
  ]) {
    for (const provider of providers) await teardownCredential(tenantKey, provider);
    try {
      const TenantModel = getModels.getTenant();
      await TenantModel.destroy({ where: { tenant_key: tenantKey } });
    } catch (_) { /* best-effort */ }
  }
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('HUMAN_EXTERNAL_BOOTSTRAP — patch não aplicável reroteia em vez de repetir o mesmo modelo', () => {
  jest.setTimeout(180000);

  test('corpo de hunk sem prefixo é rejeitado, reroteia para outro provider e a task chega em GREEN', async () => {
    if (skipIfNoDatabase()) return;

    const task = await engineeringTaskService.createTask({
      title: 'jest-patch-format-e2e: adicionar add() em mathUtils',
      objective: 'A função add() precisa existir e somar dois números corretamente.',
      taskType: 'BUG_FIX',
      risk: 'LOW',
      allowedPaths: [FIXTURE_FILE],
      testCommands: [FIXTURE_TEST_COMMAND],
      maxIterations: 6,
    }, { createdBy: 'jest-patch-format-e2e' });
    createdTaskIds.push(task.id);

    const result = await runTask(task.id, { runnerId: 'jest-patch-format-e2e-runner', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });

    // (3) o provider seguinte assumiu e o trabalho foi concluído de verdade.
    expect(result.status).toBe('GREEN');
    const finalTask = await engineeringTaskService.getTask(task.id);
    expect(finalTask.status).toBe('GREEN');
    expect(finalTask.routing_decision.coder.selected.providerId).toBe(WORKING_PROVIDER);

    // (1) o patch defeituoso foi recusado pelo FORMATO, com código próprio e ANTES do git apply —
    // nenhum `PATCH_APPLY_FAILED` nesta task, que é exatamente o sintoma que o bootstrap elimina.
    const attempts = await engineeringTaskService.listAttempts(task.id);
    expect(attempts.length).toBeGreaterThan(1);
    const brokenAttempts = attempts.filter((a) => a.coder_provider === BROKEN_PROVIDER);
    expect(brokenAttempts.length).toBeGreaterThan(0);
    for (const broken of brokenAttempts) {
      expect(broken.error.code).toBe('PATCH_BODY_MISSING_PREFIX');
      expect(broken.status).toBe('PATCH_REJECTED');
    }
    expect(attempts.some((a) => (a.error || {}).code === 'PATCH_APPLY_FAILED')).toBe(false);

    const lastAttempt = attempts[attempts.length - 1];
    expect(lastAttempt.coder_provider).toBe(WORKING_PROVIDER);
    expect(lastAttempt.status).toBe('DONE');
    expect(lastAttempt.patch_diff).toBe(FIX_DIFF);

    // (2)+(4) a cadeia de decisão está preservada na telemetria: geração (provider/modelo/arquivo/
    // hunk/código da falha), decisão explícita de reroute com o alvo, e o desfecho bem-sucedido do
    // provider que assumiu — é o que permite calcular confiabilidade de geração por provider/modelo.
    const telemetry = await engineeringTaskService.listTelemetry(task.id);
    const patchEvents = telemetry.filter((e) => e.event_type === 'PATCH_GENERATION');
    expect(patchEvents.length).toBeGreaterThanOrEqual(2);

    const rejection = patchEvents.find((e) => e.provider === BROKEN_PROVIDER);
    expect(rejection).toBeTruthy();
    expect(rejection.result).toBe('PATCH_BODY_MISSING_PREFIX');
    expect(rejection.detail.failureCode).toBe('PATCH_BODY_MISSING_PREFIX');
    expect(rejection.detail.failureKind).toBe('PATCH_NOT_APPLICABLE');
    expect(rejection.detail.patchTotalHunks).toBeGreaterThanOrEqual(1);
    expect(rejection.detail.patchFiles[0].path).toBe(FIXTURE_FILE);
    expect(rejection.detail.attemptNumber).toBeGreaterThanOrEqual(1);

    const decision = telemetry.find((e) => e.event_type === 'PATCH_DECISION');
    expect(decision).toBeTruthy();
    expect(decision.result).toBe('REROUTED');
    expect(decision.provider).toBe(BROKEN_PROVIDER);
    expect(decision.detail.failureCode).toBe('PATCH_BODY_MISSING_PREFIX');
    expect(decision.detail.failuresOnThisModel).toBe(1);
    expect(decision.detail.rerouteThreshold).toBe(1);
    expect(decision.detail.rerouted).toBe(true);
    // O alvo é SEMPRE outro modelo (nunca o mesmo que acabou de reproduzir o defeito) e é o
    // próximo candidato qualificado mais barato — não necessariamente o provider final.
    expect(decision.detail.rerouteTarget).toBeTruthy();
    expect(decision.detail.rerouteTarget).not.toBe(`${decision.provider}:${decision.model}`);
    // Toda decisão registrada do defeito troca de modelo no mesmo limiar (nenhuma repete o mesmo).
    for (const d of telemetry.filter((e) => e.event_type === 'PATCH_DECISION')) {
      expect(d.detail.rerouted).toBe(true);
      expect(d.detail.failuresOnThisModel).toBe(1);
      expect(d.detail.rerouteTarget).toBeTruthy();
    }

    const applied = patchEvents.find((e) => e.provider === WORKING_PROVIDER && e.result === 'PATCH_APPLIED');
    expect(applied).toBeTruthy();
    expect(applied.model).toBe(lastAttempt.coder_model);
  });

  test('os orçamentos impedem loop infinito: sem convergência a task termina em estado terminal honesto', async () => {
    if (skipIfNoDatabase()) return;

    const task = await engineeringTaskService.createTask({
      title: 'jest-patch-format-budget: orçamento impede repetição infinita',
      objective: 'A função add() precisa existir e somar dois números corretamente.',
      taskType: 'BUG_FIX',
      risk: 'LOW',
      allowedPaths: [FIXTURE_FILE],
      testCommands: [FIXTURE_TEST_COMMAND],
      maxIterations: 2,
    }, { createdBy: 'jest-patch-format-budget' });
    createdTaskIds.push(task.id);

    const result = await runTask(task.id, { runnerId: 'jest-patch-format-budget-runner', credentialScope: TEST_TENANT_KEY_NO_ALTERNATIVE, eventAudienceTenantId: TEST_TENANT_KEY_NO_ALTERNATIVE });

    // Estado terminal honesto (nunca "GREEN" falso, nunca laço): o orçamento de iterações da task
    // (ou o da cadeia de providers) encerra a execução.
    expect(result.status).toBe('RED');
    expect(['ENGINEERING_TASK_EXHAUSTED', 'NO_ALTERNATIVE_CANDIDATE', 'PROVIDER_EXHAUSTED']).toContain(result.reasonCode);

    const attempts = await engineeringTaskService.listAttempts(task.id);
    expect(attempts.length).toBeLessThanOrEqual(2);
    // Nenhum modelo foi repetido com o mesmo defeito: o reroute troca de candidato em vez de
    // reexecutar o mesmo CODER.
    const modelKeys = attempts.map((a) => `${a.coder_provider}:${a.coder_model}`);
    expect(new Set(modelKeys).size).toBe(modelKeys.length);
    for (const attempt of attempts) {
      expect(attempt.error.code).toBe('PATCH_BODY_MISSING_PREFIX');
    }
    // A repetição do defeito no mesmo modelo é impossível por construção: `failuresOnThisModel`
    // nunca passa de 1 (limiar) — e a decisão fica registrada na telemetria.
    const telemetry = await engineeringTaskService.listTelemetry(task.id);
    const decisions = telemetry.filter((e) => e.event_type === 'PATCH_DECISION');
    expect(decisions.length).toBeGreaterThan(0);
    for (const decision of decisions) {
      expect(decision.detail.failuresOnThisModel).toBeLessThanOrEqual(1);
    }
  });

  test('429/quota não provoca retry inútil do MESMO modelo: a cadeia progride e alcança o saudável', async () => {
    if (skipIfNoDatabase()) return;

    const task = await engineeringTaskService.createTask({
      title: 'jest-quota-progression-e2e: adicionar add() em mathUtils',
      objective: 'A função add() precisa existir e somar dois números corretamente.',
      taskType: 'BUG_FIX',
      risk: 'LOW',
      allowedPaths: [FIXTURE_FILE],
      testCommands: [FIXTURE_TEST_COMMAND],
      maxIterations: 6,
    }, { createdBy: 'jest-quota-progression-e2e' });
    createdTaskIds.push(task.id);

    const result = await runTask(task.id, { runnerId: 'jest-quota-progression-e2e-runner', credentialScope: TEST_TENANT_KEY_QUOTA, eventAudienceTenantId: TEST_TENANT_KEY_QUOTA });

    // O provider sem crédito não pode consumir a execução inteira: a cadeia progride até o
    // provider saudável, que entrega o trabalho de verdade.
    expect(result.status).toBe('GREEN');
    const attempts = await engineeringTaskService.listAttempts(task.id);
    const quotaAttempts = attempts.filter((a) => a.coder_provider === QUOTA_PROVIDER);
    expect(quotaAttempts.length).toBeGreaterThan(0);

    // NENHUM modelo foi tentado duas vezes na mesma execução (o oposto do retry cego).
    const modelKeys = attempts.map((a) => `${a.coder_provider}:${a.coder_model}`);
    expect(new Set(modelKeys).size).toBe(modelKeys.length);
    // O provider sem crédito aparece uma vez por MODELO, nunca repetindo o mesmo.
    const quotaModels = quotaAttempts.map((a) => a.coder_model);
    expect(new Set(quotaModels).size).toBe(quotaModels.length);
    for (const attempt of quotaAttempts) {
      expect(attempt.error.code).toBe('PROVIDER_UNAVAILABLE');
    }

    const lastAttempt = attempts[attempts.length - 1];
    expect(lastAttempt.coder_provider).toBe(WORKING_PROVIDER);
    expect(lastAttempt.status).toBe('DONE');

    // A progression gastou exatamente UMA tentativa no provider sem crédito e seguiu adiante —
    // antes do bootstrap a mesma condição podia consumir a execução inteira no mesmo candidato.
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts[0].coder_provider).toBe(QUOTA_PROVIDER);
  });
});
