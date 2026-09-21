'use strict';

/**
 * ERV1-CLOSE-005 — promoção do patch EXATO validado, testada diretamente na unidade
 * `promotionService` (infra real: git de verdade, workspace real via patchApplyService).
 *
 * Cobre os cenários centrais exigidos pela missão de fechamento:
 *   - patch validado produz commit real cujo diff é EXATAMENTE o patch aplicado;
 *   - branch candidata local aponta para esse commit; nunca toca HEAD/branch atual;
 *   - target divergido (alguém commitou no repo real entre a criação do workspace e a
 *     promoção) bloqueia a promoção explicitamente, nunca promove sobre um alvo errado;
 *   - smoke pós-promoção roda de verdade num worktree novo a partir do commit candidato.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createWorkspace, applyPatch, destroyWorkspace } = require('../../api/services/engineeringRouter/patchApplyService');
const { promoteValidatedPatch, candidateBranchName } = require('../../api/services/engineeringRouter/promotionService');

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

function realHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function deleteBranchIfExists(name) {
  try { execFileSync('git', ['branch', '-D', name], { cwd: REPO_ROOT, stdio: 'ignore' }); } catch (_) { /* ok */ }
}

describe('ERV1-CLOSE-005 — promotionService.promoteValidatedPatch (git real)', () => {
  jest.setTimeout(30000);
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

  test('promove com sucesso: commit real + branch real, diff promovido == diff validado, smoke PASS', async () => {
    const taskId = `jest-promotion-success-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    const result = await promoteValidatedPatch({
      taskId,
      attemptId: 'jest-attempt-1',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'jest promotion success test',
    });
    createdBranches.push(candidateBranchName(taskId));

    expect(result.promoted).toBe(true);
    expect(result.evidence.postPromotionTestPass).toBe(true);
    expect(result.evidence.candidateBranch).toBe(candidateBranchName(taskId));

    // O branch real existe e aponta para o commit real.
    const branchHead = execFileSync('git', ['rev-parse', result.evidence.candidateBranch], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    expect(branchHead).toBe(result.evidence.candidateCommit);

    // Diff promovido == diff validado: o conteúdo real do arquivo no commit candidato tem add().
    const promotedContent = execFileSync('git', ['show', `${result.evidence.candidateCommit}:${FIXTURE_FILE}`], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(promotedContent).toContain('function add(a, b)');
    expect(promotedContent).toContain('return a + b;');

    // Nunca tocou HEAD/branch atual do repositório principal.
    expect(realHead()).toBe(result.evidence.targetHead);
  });

  test('target divergido bloqueia a promoção — nunca promove sobre um baseline que já mudou', async () => {
    const taskId = `jest-promotion-diverged-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    // Simula divergência: um commit real (solto, não referenciado) diferente do HEAD real
    // "aconteceu" entre a criação do workspace e a promoção — usamos um targetHead FALSO via
    // reescrita direta do resultado esperado: como promoteValidatedPatch lê o HEAD real do
    // próprio ROOT no momento da chamada, simulamos a divergência criando o workspace, depois
    // corrompendo deliberadamente o "baseline" que ele reportaria — mais simples e real:
    // comparamos diretamente que a checagem de divergência existe e funciona chamando com um
    // workspace cujo pai NÃO é o HEAD atual (workspace antigo "stale").
    //
    // Para isso de forma determinística: criamos DOIS workspaces em sequência; o HEAD real não
    // muda entre eles neste teste (não temos como commitar de verdade em HEAD sem afetar o
    // repositório), então validamos o code path de divergência diretamente via os pré-requisitos
    // que o service checa (baselineHead resolvido do workspace vs. HEAD real).
    const baselineFromWorkspace = execFileSync('git', ['rev-parse', 'HEAD^'], { cwd: workspace, encoding: 'utf8' }).trim();
    expect(baselineFromWorkspace).toBe(realHead());

    // Prova indireta e real do bloqueio: se o HEAD real do ROOT não bater com o baseline do
    // workspace, o código deve reprovar. Como não podemos mover o HEAD real do repositório
    // compartilhado com segurança neste teste, validamos a MESMA função de comparação usada
    // internamente com um par divergente real (dois commits reais e distintos do próprio
    // histórico do repositório).
    const { execFile } = require('child_process');
    const util = require('util');
    const execFileAsync = util.promisify(execFile);
    const log = await execFileAsync('git', ['log', '--format=%H', '-n', '2'], { cwd: REPO_ROOT });
    const [currentHead, previousCommit] = log.stdout.trim().split('\n');
    expect(currentHead).not.toBe(previousCommit);

    // `promoteValidatedPatch` resolve targetHead como o HEAD real do ROOT (sempre `currentHead`
    // no momento do teste), e o baseline do workspace como `HEAD^` DENTRO do workspace — para
    // provar a reprovação real, criamos um workspace a partir de um commit-snapshot cujo PAI é
    // `previousCommit` (um commit real anterior, não o HEAD atual), simulando exatamente uma
    // tentativa cujo baseline ficou velho (mesma técnica de createSnapshotCommit, apontando
    // para um pai antigo em vez do HEAD atual).
    const env = { ...process.env, GIT_AUTHOR_NAME: 'jest', GIT_AUTHOR_EMAIL: 'jest@local', GIT_COMMITTER_NAME: 'jest', GIT_COMMITTER_EMAIL: 'jest@local' };
    const staleTree = execFileSync('git', ['rev-parse', `${previousCommit}^{tree}`], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const staleSnapshotCommit = execFileSync('git', ['commit-tree', staleTree, '-p', previousCommit, '-m', 'stale snapshot for jest'], { cwd: REPO_ROOT, env, encoding: 'utf8' }).trim();

    const staleWorkspaceDir = path.join(require('os').tmpdir(), `engineering-router-workspaces`, `jest-stale-${Date.now()}`);
    fs.mkdirSync(path.dirname(staleWorkspaceDir), { recursive: true });
    execFileSync('git', ['worktree', 'add', '--detach', staleWorkspaceDir, staleSnapshotCommit], { cwd: REPO_ROOT });
    createdWorkspaces.push(staleWorkspaceDir);

    const result = await promoteValidatedPatch({
      taskId: `jest-promotion-diverged-real-${Date.now()}`,
      attemptId: 'jest-attempt-diverged',
      attemptNumber: 1,
      workspacePath: staleWorkspaceDir,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'jest promotion diverged test',
    });

    expect(result.promoted).toBe(false);
    expect(result.code).toBe('PROMOTION_TARGET_DIVERGED');
    expect(result.evidence.baselineHead).toBe(previousCommit);
    expect(result.evidence.targetHead).toBe(currentHead);
    expect(result.evidence.baselineHead).not.toBe(result.evidence.targetHead);
  });
});
