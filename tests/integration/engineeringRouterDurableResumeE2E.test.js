'use strict';

/**
 * ER-V1-SEALFIX-004 (Phase-Aware Durable Resume) — prova, com Postgres real e a API PÚBLICA
 * (`runTask`, nunca uma chamada interna de conveniência), que um crash real de PROCESSO (não
 * só uma exceção capturada) em qualquer fase pós-CODE é retomado corretamente na próxima
 * chamada, sem duplicar tentativa, sem duplicar efeito colateral, sem promover duas vezes.
 *
 * Achado real que motivou esta missão: antes desta correção, `executeRoutedLoop` SEMPRE
 * recomeçava do zero em CODING depois de um restart — `operationService.beginOrReconcile`
 * (ER-V1-SEAL-002) já existia e já era seguro, mas NUNCA era alcançado de novo depois que o
 * PROCESSO (não só a promise) morria, porque o loop externo nunca sabia que devia re-entrar
 * na fase ADVANCE em vez de criar uma tentativa nova.
 *
 * "Matar o processo" aqui é simulado por manipulação direta de estado no banco — mesma técnica
 * já estabelecida nesta suíte (ver `engineeringTaskConcurrencyAndRestart.test.js` ER-V1-FINAL-005
 * e `engineeringPromotionCandidateSplit.test.js` ER-V1-SEAL-002) para representar exatamente o
 * que um processo real teria persistido antes de morrer, sem a fragilidade de matar um processo
 * Node de verdade dentro do Jest.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const sequelizeModule = require('../../api/db/sequelize');
const { registerAiProvider, clearAiProviderConfig } = require('../../api/services/aiProviderManager');
const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const operationService = require('../../api/services/engineeringRouter/engineeringOperationService');
const { candidateBranchName } = require('../../api/services/engineeringRouter/promotionService');
const {
  runTask, ensureRouted, runOneAttempt,
} = require('../../api/services/engineeringRouter/engineeringRouterService');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CODER_PROVIDER = 'anthropic';
const REVIEWER_PROVIDER = 'anthropic'; // risco LOW: independência de provider não é exigida.
const TEST_TENANT_KEY = 'jest-e2e-engineering-router-durable-resume';

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
  // eslint-disable-next-line no-console
  console.warn(`[engineering-router-durable-resume] PULADO: postgres_unreachable (${dbReason})`);
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

function deleteCandidateBranchIfExists(taskId) {
  try {
    execFileSync('git', ['branch', '-D', candidateBranchName(taskId)], { cwd: REPO_ROOT, stdio: 'ignore' });
  } catch (_) { /* branch pode não ter sido criada */ }
}

async function makeTask(title, { riskOverride = 'LOW' } = {}) {
  const task = await engineeringTaskService.createTask({
    title,
    objective: 'A função add() precisa existir e somar dois números corretamente.',
    taskType: 'BUG_FIX',
    risk: riskOverride,
    allowedPaths: [FIXTURE_FILE],
    testCommands: [FIXTURE_TEST_COMMAND],
    maxIterations: 3,
  }, { createdBy: 'jest-e2e-durable-resume' });
  createdTaskIds.push(task.id);
  return task;
}

/** Roda o CODER/TESTING/REVIEWING reais uma vez (via a mesma função pública que o loop usa),
 * simulando o estado exato que um processo real teria persistido logo ANTES de entrar na fase
 * ADVANCE (REGRESSION→GOVERNANCE→PROMOTING→POST_PROMOTION_VERIFY→GREEN) — sem nunca chamar
 * `advanceFromCodedAttempt`, para que o teste controle exatamente onde o "crash" acontece.
 */
async function codeTestReviewOnce(task) {
  const routedTask = await ensureRouted(task, { credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });
  const result = await runOneAttempt({
    task: routedTask,
    routingDecision: routedTask.routing_decision,
    failureBundle: null,
    previousAttempt: null,
    credentialScope: TEST_TENANT_KEY,
    eventAudienceTenantId: TEST_TENANT_KEY,
  });
  expect(result.outcome).toBe('ADVANCE');
  return { routedTask, result };
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
    defaults: { tenant_key: TEST_TENANT_KEY, name: 'Jest E2E — Durable Resume', status: 'active', plan: 'enterprise' },
  });

  await setupCredential(TEST_TENANT_KEY, CODER_PROVIDER);

  registerAiProvider(CODER_PROVIDER, {
    async generate(prompt, context) {
      if (context.purpose === 'engineering_coder') {
        return { text: JSON.stringify({ summary: 'adiciona função add em mathUtils', diff: FIX_DIFF }), usage: { prompt_tokens: 120, completion_tokens: 60 } };
      }
      if (context.purpose === 'engineering_reviewer') {
        return { text: JSON.stringify({ decision: 'APPROVE', findings: [] }), usage: { prompt_tokens: 80, completion_tokens: 20 } };
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
      const Operation = getModels.getEngineeringOperation ? getModels.getEngineeringOperation() : null;
      await Attempt.destroy({ where: { task_id: taskId } });
      await Telemetry.destroy({ where: { task_id: taskId } });
      if (Operation) await Operation.destroy({ where: { task_id: taskId } }).catch(() => {});
      const Task = getModels.getEngineeringTask();
      await Task.destroy({ where: { id: taskId } });
    }
  } catch (_) { /* best-effort */ }

  await teardownCredential(TEST_TENANT_KEY, CODER_PROVIDER);
  try {
    const TenantModel = getModels.getTenant();
    await TenantModel.destroy({ where: { tenant_key: TEST_TENANT_KEY } });
  } catch (_) { /* best-effort */ }
  await sequelizeModule.close().catch(() => {});
}, 30000);

describe('ER-V1-SEALFIX-004 — Phase-Aware Durable Resume (crash real simulado, runTask público)', () => {
  jest.setTimeout(180000);

  test('crash logo ao ENTRAR em REGRESSION (nenhuma operation ainda começou) → runTask retomado chega a GREEN, sem tentativa duplicada', async () => {
    if (skipIfNoDatabase()) return;

    const task = await makeTask('jest-resume: crash em REGRESSION');
    const { routedTask } = await codeTestReviewOnce(task);

    // "Crash": o processo persistiu a transição para REGRESSION e morreu antes de chamar
    // operationService.beginOrReconcile pela primeira vez para esta fase — exatamente o
    // estado que `task.status='REGRESSION'` + attempt DONE representam sozinhos.
    await engineeringTaskService.transitionTask(task.id, 'REGRESSION');

    const attemptsBefore = await engineeringTaskService.listAttempts(task.id);
    expect(attemptsBefore).toHaveLength(1);

    const result = await runTask(task.id, { runnerId: 'jest-resume-regression', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });
    expect(result.status).toBe('GREEN');

    const attemptsAfter = await engineeringTaskService.listAttempts(task.id);
    expect(attemptsAfter).toHaveLength(1);
    expect(attemptsAfter[0].id).toBe(attemptsBefore[0].id);
    void routedTask;
  });

  test('crash logo ao ENTRAR em GOVERNANCE (REGRESSION já persistida) → runTask retomado chega a GREEN, sem tentativa duplicada nem regressão duplicada', async () => {
    if (skipIfNoDatabase()) return;

    const task = await makeTask('jest-resume: crash em GOVERNANCE');
    await codeTestReviewOnce(task);

    await engineeringTaskService.transitionTask(task.id, 'REGRESSION');
    await engineeringTaskService.transitionTask(task.id, 'GOVERNANCE');

    const result = await runTask(task.id, { runnerId: 'jest-resume-governance', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });
    expect(result.status).toBe('GREEN');

    const attempts = await engineeringTaskService.listAttempts(task.id);
    expect(attempts).toHaveLength(1);
  });

  test('CRASH REAL crítico: candidate de PROMOTING já criado + operation RUNNING órfã → runTask retomado NUNCA promove duas vezes (findExistingCandidate via advanceFromCodedAttempt real)', async () => {
    if (skipIfNoDatabase()) return;

    const task = await makeTask('jest-resume: crash apos candidate criado em PROMOTING');
    const { result: codedResult } = await codeTestReviewOnce(task);

    await engineeringTaskService.transitionTask(task.id, 'REGRESSION');
    await engineeringTaskService.transitionTask(task.id, 'GOVERNANCE');
    await engineeringTaskService.transitionTask(task.id, 'PROMOTING');

    // Simula a PRIMEIRA tentativa real de promoção (exatamente o que o loop real faz): abre a
    // operation, cria o candidate REAL (commit + branch reais), e então o processo morre ANTES
    // de chamar completeOperation — a operation fica RUNNING para sempre no banco.
    const { createPromotionCandidate } = require('../../api/services/engineeringRouter/promotionService');
    const attemptId = codedResult.attempt.id;
    const firstOp = await operationService.beginOrReconcile({ taskId: task.id, attemptId, phase: 'PROMOTING' });
    expect(firstOp.action).toBe('RUN');
    const created = await createPromotionCandidate({
      taskId: task.id,
      attemptId,
      attemptNumber: codedResult.attempt.attempt_number,
      workspacePath: codedResult.workspace,
      diff: codedResult.diff,
      taskTitle: 'sealfix-004 crash apos candidate criado',
    });
    expect(created.created).toBe(true);

    // Envelhece started_at para simular um processo morto de verdade (mesma técnica de
    // engineeringPromotionCandidateSplit.test.js — ER-V1-SEAL-002).
    const getEngineeringOperationModel = require('../../api/db/models/EngineeringOperation');
    const OperationModel = getEngineeringOperationModel();
    await OperationModel.update(
      { started_at: new Date(Date.now() - 20 * 60 * 1000) },
      { where: { id: firstOp.operation.id } },
    );

    // RESTART real: chama runTask do zero para esta task, do jeito que um orquestrador real
    // chamaria após o processo voltar a subir. Antes desta missão, isto NUNCA alcançaria
    // findExistingCandidate — recomeçaria em CODING, arriscando um segundo candidate/commit.
    const result = await runTask(task.id, { runnerId: 'jest-resume-promoting', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });
    expect(result.status).toBe('GREEN');

    const attempts = await engineeringTaskService.listAttempts(task.id);
    expect(attempts).toHaveLength(1);

    // PROVA FINAL: só UMA branch candidata real existe no git — nenhum segundo commit foi
    // criado pela retomada.
    const branches = execFileSync('git', ['branch', '--list', candidateBranchName(task.id)], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean);
    expect(branches).toHaveLength(1);
    const branchHead = execFileSync('git', ['rev-parse', candidateBranchName(task.id)], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    expect(branchHead).toBe(created.evidence.candidateCommit);
  });

  test('crash logo ao ENTRAR em POST_PROMOTION_VERIFY (candidate já promovido de verdade) → runTask retomado confirma GREEN sem promover de novo', async () => {
    if (skipIfNoDatabase()) return;

    const task = await makeTask('jest-resume: crash em POST_PROMOTION_VERIFY');
    const { result: codedResult } = await codeTestReviewOnce(task);

    await engineeringTaskService.transitionTask(task.id, 'REGRESSION');
    await engineeringTaskService.transitionTask(task.id, 'GOVERNANCE');
    await engineeringTaskService.transitionTask(task.id, 'PROMOTING');

    const { createPromotionCandidate } = require('../../api/services/engineeringRouter/promotionService');
    const attemptId = codedResult.attempt.id;
    const promotingOp = await operationService.beginOrReconcile({ taskId: task.id, attemptId, phase: 'PROMOTING' });
    const created = await createPromotionCandidate({
      taskId: task.id,
      attemptId,
      attemptNumber: codedResult.attempt.attempt_number,
      workspacePath: codedResult.workspace,
      diff: codedResult.diff,
      taskTitle: 'sealfix-004 crash em post-promotion-verify',
    });
    expect(created.created).toBe(true);
    await operationService.completeOperation(promotingOp.operation.id, { evidenceRef: created.evidence });

    // Candidate real já promovido (efeito irreversível já aconteceu de verdade); processo
    // morre transicionando para POST_PROMOTION_VERIFY, antes do smoke pós-promoção confirmar.
    await engineeringTaskService.transitionTask(task.id, 'POST_PROMOTION_VERIFY');

    const result = await runTask(task.id, { runnerId: 'jest-resume-verify', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });
    expect(result.status).toBe('GREEN');

    const branches = execFileSync('git', ['branch', '--list', candidateBranchName(task.id)], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean);
    expect(branches).toHaveLength(1);
  });

  test('crash com tentativa PRESA em CODING/TESTING/REVIEWING (sem efeito irreversível) → tentativa anterior marcada ABANDONED explicitamente, nova tentativa criada, chega a GREEN', async () => {
    if (skipIfNoDatabase()) return;

    const task = await makeTask('jest-resume: crash em fase sem efeito irreversivel');
    await codeTestReviewOnce(task);

    // Simula o processo morrendo NO MEIO de runOneAttempt (nunca retornou) — reverte
    // manualmente o attempt para um status "em voo" que nenhum retorno real de runOneAttempt
    // deixaria persistido (todo retorno real sempre deixa um status terminal-para-a-tentativa).
    const attemptsBefore = await engineeringTaskService.listAttempts(task.id);
    expect(attemptsBefore).toHaveLength(1);
    const getModels = require('../../api/db/models');
    const AttemptModel = getModels.getEngineeringAttempt();
    await AttemptModel.update({ status: 'TESTED' }, { where: { id: attemptsBefore[0].id } });
    // task.status já é 'REVIEWING' neste ponto (última transição real feita por
    // `codeTestReviewOnce`/`runOneAttempt`) — não precisa (nem pode: mesmo-estado não é uma
    // transição real) de nova chamada aqui.

    const result = await runTask(task.id, { runnerId: 'jest-resume-abandon', credentialScope: TEST_TENANT_KEY, eventAudienceTenantId: TEST_TENANT_KEY });
    expect(result.status).toBe('GREEN');

    const attemptsAfter = await engineeringTaskService.listAttempts(task.id);
    // Tentativa original abandonada explicitamente (auditável) + uma tentativa nova real que
    // chegou a GREEN — nunca silenciosamente ignorada, nunca "retomada" de dentro de uma fase
    // sem efeito irreversível persistido o suficiente para ser seguro.
    expect(attemptsAfter.length).toBeGreaterThanOrEqual(2);
    const abandoned = attemptsAfter.find((a) => a.id === attemptsBefore[0].id);
    expect(abandoned.status).toBe('ABANDONED');
    expect(abandoned.error?.code).toBe('RESUME_ABANDONED_INCOMPLETE_PHASE');
  });
});
