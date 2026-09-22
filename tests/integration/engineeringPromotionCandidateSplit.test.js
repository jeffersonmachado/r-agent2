'use strict';

/**
 * ER-V1-SEAL-002 (Full Durable Resume) — prova real de que `createPromotionCandidate` +
 * `verifyPromotedCandidate` (a divisão de `promoteValidatedPatch` em duas etapas, feita para dar
 * ao reconciliador um ponto de corte real entre "candidate criado" e "smoke confirmado") se
 * comportam corretamente de forma isolada, e que `findExistingCandidate` detecta de verdade uma
 * branch candidata já promovida a partir do `validatedPatchHash` gravado na mensagem do commit.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createWorkspace, applyPatch, destroyWorkspace } = require('../../api/services/engineeringRouter/patchApplyService');
const { createPromotionCandidate, verifyPromotedCandidate, findExistingCandidate, candidateBranchName } = require('../../api/services/engineeringRouter/promotionService');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
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

function deleteBranchIfExists(name) {
  try { execFileSync('git', ['branch', '-D', name], { cwd: REPO_ROOT, stdio: 'ignore' }); } catch (_) { /* ok */ }
}

describe('ER-V1-SEAL-002 — createPromotionCandidate / verifyPromotedCandidate / findExistingCandidate (git real)', () => {
  jest.setTimeout(90000);
  const createdWorkspaces = [];
  const createdBranches = [];

  afterEach(async () => {
    for (const ws of createdWorkspaces.splice(0)) {
      if (fs.existsSync(ws)) await destroyWorkspace(ws).catch(() => {});
    }
    for (const branch of createdBranches.splice(0)) {
      deleteBranchIfExists(branch);
    }
  });

  test('findExistingCandidate não encontra nada quando a branch candidata nunca existiu', async () => {
    const found = await findExistingCandidate({ taskId: `jest-seal-002-never-existed-${Date.now()}`, validatedPatchHash: 'qualquer-hash' });
    expect(found.found).toBe(false);
  });

  test('createPromotionCandidate sozinho cria commit real + branch, SEM rodar o smoke (efeito de POST_PROMOTION_VERIFY nunca acontece aqui)', async () => {
    const taskId = `jest-seal-002-create-only-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);
    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    const result = await createPromotionCandidate({
      taskId,
      attemptId: 'attempt-create-only',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      taskTitle: 'seal-002 create only',
    });
    createdBranches.push(candidateBranchName(taskId));

    expect(result.created).toBe(true);
    expect(result.evidence.candidateCommit).toBeTruthy();
    expect(result.evidence.candidateBranch).toBe(candidateBranchName(taskId));
    // Nenhum campo de smoke presente ainda — prova que a etapa 1 não executa a etapa 2.
    expect(result.evidence.postPromotionTreeHash).toBeUndefined();
    expect(result.evidence.postPromotionTestPass).toBeUndefined();

    // A branch real já existe no git, mesmo sem o smoke ter rodado — efeito irreversível já
    // aconteceu, exatamente o ponto que ER-V1-SEAL-002 precisa distinguir.
    const branchHead = execFileSync('git', ['rev-parse', result.evidence.candidateBranch], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    expect(branchHead).toBe(result.evidence.candidateCommit);
  });

  test('findExistingCandidate encontra a branch candidata real criada por createPromotionCandidate, pelo validatedPatchHash exato', async () => {
    const taskId = `jest-seal-002-find-after-create-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);
    await applyPatch(workspace, FIX_DIFF);

    const created = await createPromotionCandidate({
      taskId,
      attemptId: 'attempt-find',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      taskTitle: 'seal-002 find after create',
    });
    createdBranches.push(candidateBranchName(taskId));
    expect(created.created).toBe(true);

    const found = await findExistingCandidate({ taskId, validatedPatchHash: created.evidence.validatedPatchHash });
    expect(found.found).toBe(true);
    expect(found.candidateCommit).toBe(created.evidence.candidateCommit);

    // Um hash DIFERENTE (patch diferente) nunca é confundido com este candidate real.
    const notFound = await findExistingCandidate({ taskId, validatedPatchHash: 'hash-de-outro-patch-completamente-diferente' });
    expect(notFound.found).toBe(false);
  });

  test('verifyPromotedCandidate, chamado separadamente depois, roda o smoke real e confirma a árvore promovida', async () => {
    const taskId = `jest-seal-002-verify-separately-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);
    await applyPatch(workspace, FIX_DIFF);

    const created = await createPromotionCandidate({
      taskId,
      attemptId: 'attempt-verify',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      taskTitle: 'seal-002 verify separately',
    });
    createdBranches.push(candidateBranchName(taskId));
    expect(created.created).toBe(true);

    const verified = await verifyPromotedCandidate({
      taskId,
      attemptNumber: 1,
      candidateCommit: created.evidence.candidateCommit,
      validatedTreeHash: created.evidence.validatedTreeHash,
      testCommands: [FIXTURE_TEST_COMMAND],
    });

    expect(verified.verified).toBe(true);
    expect(verified.postPromotionTestPass).toBe(true);
    expect(verified.postPromotionTreeHash).toBe(created.evidence.validatedTreeHash);
  });
});

describe('ER-V1-SEAL-002 — crash real simulado em PROMOTING nunca promove duas vezes', () => {
  jest.setTimeout(90000);
  const createdWorkspaces = [];
  const createdBranches = [];
  const sequelizeModule = require('../../api/db/sequelize');
  const operationService = require('../../api/services/engineeringRouter/engineeringOperationService');

  let dbAvailable = false;
  let dbReason = null;

  const createdTaskIds = [];

  beforeAll(async () => {
    try {
      await sequelizeModule.connect(2, 250);
      dbAvailable = true;
    } catch (error) {
      dbAvailable = false;
      dbReason = error.message;
    }
  });

  afterEach(async () => {
    for (const ws of createdWorkspaces.splice(0)) {
      if (fs.existsSync(ws)) await destroyWorkspace(ws).catch(() => {});
    }
    for (const branch of createdBranches.splice(0)) {
      deleteBranchIfExists(branch);
    }
    if (dbAvailable) {
      const getEngineeringOperationModel = require('../../api/db/models/EngineeringOperation');
      const Model = getEngineeringOperationModel();
      for (const taskId of createdTaskIds.splice(0)) {
        await Model.destroy({ where: { task_id: taskId } }).catch(() => {});
      }
    }
  });

  afterAll(async () => {
    await sequelizeModule.close().catch(() => {});
  });

  test('CRASH REAL: candidate já criado antes do crash + operation RUNNING órfã → RECONCILE encontra o candidate real via findExistingCandidate, nunca cria um segundo', async () => {
    if (!dbAvailable) {
      console.warn(`[promotion-crash-test] PULADO: postgres_unreachable (${dbReason})`);
      return;
    }

    // task_id em engineering_operations é UUID (mesma convenção real de EngineeringTask) —
    // usar um UUID de verdade, mesmo sem uma EngineeringTask persistida correspondente (este
    // teste exercita só a reconciliação, não o vínculo de FK).
    const taskId = require('crypto').randomUUID();
    createdTaskIds.push(taskId);
    const attemptId = require('crypto').randomUUID();
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);
    await applyPatch(workspace, FIX_DIFF);

    // 1. Simula a PRIMEIRA tentativa: cria a operation PROMOTING (RUN) e o candidate real de
    //    verdade — exatamente o que o loop real faz antes de crashar.
    const firstOp = await operationService.beginOrReconcile({ taskId, attemptId, phase: 'PROMOTING' });
    expect(firstOp.action).toBe('RUN');

    const created = await createPromotionCandidate({
      taskId,
      attemptId,
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      taskTitle: 'seal-002 crash simulado em PROMOTING',
    });
    createdBranches.push(candidateBranchName(taskId));
    expect(created.created).toBe(true);

    // 2. CRASH: o processo morre depois de criar o candidate real (efeito irreversível já
    //    aconteceu), mas ANTES de chamar operationService.completeOperation — a operation fica
    //    para sempre RUNNING no banco, exatamente como aconteceria com um processo morto de
    //    verdade. Simulado envelhecendo started_at manualmente (mesma técnica usada em
    //    engineeringOperationService.test.js).
    const getEngineeringOperationModel = require('../../api/db/models/EngineeringOperation');
    const Model = getEngineeringOperationModel();
    await Model.update(
      { started_at: new Date(Date.now() - 20 * 60 * 1000) },
      { where: { id: firstOp.operation.id } },
    );

    // 3. RESTART: novo processo (mesma task/attempt/fase) chama beginOrReconcile de novo —
    //    precisa reportar RECONCILE (RUNNING órfão), NUNCA "RUN" (que levaria a criar um
    //    segundo candidate) nem "RESUME" automático (que fingiria saber sem checar evidência).
    const secondOp = await operationService.beginOrReconcile({ taskId, attemptId, phase: 'PROMOTING' });
    expect(secondOp.action).toBe('RECONCILE');
    expect(secondOp.reason).toBe('RUNNING_STALE');

    // 4. Resolução correta (a mesma lógica do loop real, engineeringRouterService.js): antes de
    //    criar um candidate novo, checa EVIDÊNCIA EXTERNA REAL (a branch candidata já existe no
    //    git?) — encontra o candidate criado na etapa 1, resolve via resumeWithEvidence, e NUNCA
    //    chama createPromotionCandidate uma segunda vez.
    const existing = await findExistingCandidate({ taskId, validatedPatchHash: created.evidence.validatedPatchHash });
    expect(existing.found).toBe(true);
    expect(existing.candidateCommit).toBe(created.evidence.candidateCommit);

    const resumed = await operationService.resumeWithEvidence(secondOp.operation.id, {
      evidenceRef: { candidateCommit: existing.candidateCommit, candidateBranch: existing.candidateBranch, reconciledFromExternalEvidence: true },
      reason: 'teste: branch candidata real já existia',
    });
    expect(resumed.status).toBe('SUCCEEDED');

    // 5. PROVA FINAL: só UMA branch candidata real existe no git para esta task — nenhum
    //    segundo commit/branch foi criado pela reconciliação.
    const branches = execFileSync('git', ['branch', '--list', candidateBranchName(taskId)], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n').map((l) => l.trim()).filter(Boolean);
    expect(branches).toHaveLength(1);
    const branchHead = execFileSync('git', ['rev-parse', candidateBranchName(taskId)], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    expect(branchHead).toBe(created.evidence.candidateCommit);
  });
});
