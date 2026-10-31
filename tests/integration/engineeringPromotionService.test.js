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

// QUAL REPOSITÓRIO? O que o SERVIÇO usa, não o diretório deste arquivo.
// `promotionService`/`patchApplyService` operam sobre `ROOT` de `contextBuilderService`, que honra
// `ENGINEERING_ROUTER_HOST_REPO_ROOT` (o container do Router precisa do caminho do HOST). Numa worktree
// ligada os dois divergem — medido em 2026-10-26: `.env` aponta `HOST_REPO_ROOT` para o checkout
// principal (HEAD 484eee47), enquanto `__dirname/../..` é a worktree (HEAD 8dbaec15). O teste então
// media um repositório e o serviço promovia em outro, e as duas asserções de HEAD invertiam.
const { ROOT: REPO_ROOT } = require('../../api/services/engineeringRouter/contextBuilderService');
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
    //
    // ER-V1-SEAL-001: o workspace agora é materializado DIRETAMENTE do HEAD real (imutável) —
    // `HEAD` (não mais `HEAD^`) dentro do workspace É o próprio baseline/targetCommit.
    const baselineFromWorkspace = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim();
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

    // ER-V1-SEAL-001: `promoteValidatedPatch` resolve targetHead como o HEAD real do ROOT
    // (sempre `currentHead` no momento do teste), e o baseline do workspace como `HEAD` (não
    // mais `HEAD^`) DENTRO do workspace — o workspace nasce DIRETAMENTE do commit-alvo, sem
    // indireção de snapshot com pai. Para provar a reprovação real, basta materializar um
    // worktree diretamente a partir de `previousCommit` (um commit real anterior, não o HEAD
    // atual) — simula exatamente uma tentativa cujo baseline ficou velho.
    const staleWorkspaceDir = path.join(require('os').tmpdir(), `engineering-router-workspaces`, `jest-stale-${Date.now()}`);
    fs.mkdirSync(path.dirname(staleWorkspaceDir), { recursive: true });
    execFileSync('git', ['worktree', 'add', '--detach', staleWorkspaceDir, previousCommit], { cwd: REPO_ROOT });
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

describe('ER-V1-FINAL-002 — Exact Promotion (prova de tree hash, não só diff --stat)', () => {
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

  test('promoção legítima expõe expectedTreeHash == candidateTreeHash e fileSetHash (prova positiva, cenário A)', async () => {
    const taskId = `jest-exact-promotion-clean-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    const result = await promoteValidatedPatch({
      taskId,
      attemptId: 'jest-exact-attempt-1',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'jest exact promotion clean',
    });
    createdBranches.push(candidateBranchName(taskId));

    expect(result.promoted).toBe(true);
    expect(result.evidence.expectedTreeHash).toBe(result.evidence.candidateTreeHash);
    expect(result.evidence.promotedTreeHash).toBe(result.evidence.candidateTreeHash);
    expect(result.evidence.fileSetHash).toEqual(expect.any(String));
    expect(result.evidence.promotionStatus).toBe('PROMOTED');
  });

  test('arquivo NOVO gerado como side-effect no workspace (fora do patch) bloqueia a promoção (cenário B)', async () => {
    const taskId = `jest-exact-promotion-side-effect-new-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    // Simula side-effect real de um testCommand: um arquivo NOVO aparece no workspace depois
    // do patch aplicado (cache, artefato, log — ou qualquer escrita fora do diff validado).
    const injectedFile = 'INJECTED_BY_TEST_SIDE_EFFECT.txt';
    fs.writeFileSync(path.join(workspace, injectedFile), 'nunca deveria ser promovido');

    const result = await promoteValidatedPatch({
      taskId,
      attemptId: 'jest-exact-attempt-b',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'jest exact promotion side-effect new file',
    });

    expect(result.promoted).toBe(false);
    expect(result.code).toBe('PROMOTION_TREE_CONTAMINATED');
    expect(result.evidence.expectedTreeHash).not.toBe(result.evidence.candidateTreeHash);
    expect(result.evidence.contaminatingFiles).toContain(injectedFile);
  });

  test('arquivo EXISTENTE alterado fora do diff validado bloqueia a promoção (cenário C)', async () => {
    const taskId = `jest-exact-promotion-side-effect-modify-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    // Simula side-effect real: um comando (não o patch) reescreve um arquivo já existente e
    // não relacionado ao diff validado.
    const unrelatedFile = path.join(workspace, 'package.json');
    const original = fs.readFileSync(unrelatedFile, 'utf8');
    fs.writeFileSync(unrelatedFile, original.replace('"name"', '"nameTamperedBySideEffect"'));

    const result = await promoteValidatedPatch({
      taskId,
      attemptId: 'jest-exact-attempt-c',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'jest exact promotion side-effect modify unrelated file',
    });

    expect(result.promoted).toBe(false);
    expect(result.code).toBe('PROMOTION_TREE_CONTAMINATED');
    expect(result.evidence.contaminatingFiles).toContain('package.json');
  });

  test('remoção de arquivo fora do patch validado bloqueia a promoção (cenário D)', async () => {
    const taskId = `jest-exact-promotion-side-effect-delete-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    // Simula side-effect real: algo remove um arquivo do workspace que nunca fez parte do
    // diff validado.
    const deletedFile = path.join(workspace, 'tests', 'fixtures', 'engineering-router-sandbox', 'printEnvProbe.js');
    expect(fs.existsSync(deletedFile)).toBe(true);
    fs.unlinkSync(deletedFile);

    const result = await promoteValidatedPatch({
      taskId,
      attemptId: 'jest-exact-attempt-d',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'jest exact promotion side-effect delete unrelated file',
    });

    expect(result.promoted).toBe(false);
    expect(result.code).toBe('PROMOTION_TREE_CONTAMINATED');
    expect(result.evidence.contaminatingFiles).toContain('printEnvProbe.js');
  });
});

describe('ER-V1-SEAL-001 — Immutable Promotion Baseline (dirty working tree nunca contamina o candidate)', () => {
  jest.setTimeout(90000);
  const createdWorkspaces = [];
  const createdBranches = [];
  const createdUntrackedFiles = [];

  afterEach(async () => {
    for (const ws of createdWorkspaces.splice(0)) {
      if (fs.existsSync(ws)) await destroyWorkspace(ws).catch(() => {});
    }
    for (const branch of createdBranches.splice(0)) {
      deleteBranchIfExists(branch);
    }
    for (const f of createdUntrackedFiles.splice(0)) {
      fs.rmSync(f, { force: true });
    }
    // Reverte qualquer modificação/staging real deixada nos fixtures usados por estes testes —
    // nunca deve sobrar dirty state real no ROOT depois de qualquer teste deste describe. ORDEM
    // IMPORTA: `reset` (unstage) precisa rodar ANTES de `checkout --` — se o arquivo ainda está
    // staged, `checkout --` restaura do ÍNDICE (que já tem a modificação), não do HEAD, e o
    // resíduo sobrevive silenciosamente (achado real: aconteceu na primeira versão deste teste).
    execFileSync('git', ['reset', '--quiet', '--', 'tests/fixtures/engineering-router-sandbox/printHardcodedSecretProbe.js', 'tests/fixtures/engineering-router-sandbox/writeOutsideWorkspaceProbe.js'], { cwd: REPO_ROOT, stdio: 'ignore' });
    execFileSync('git', ['checkout', '--', 'tests/fixtures/engineering-router-sandbox/printHardcodedSecretProbe.js', 'tests/fixtures/engineering-router-sandbox/writeOutsideWorkspaceProbe.js'], { cwd: REPO_ROOT, stdio: 'ignore' });
  });

  test('achado real: dirty local não relacionado (untracked) NUNCA aparece no candidate promovido', async () => {
    // RED reproduzido nesta sessão antes da correção: um arquivo `dirty-local-a.txt` criado no
    // ROOT antes de `createWorkspace` era commitado na branch candidata real junto com o patch
    // legítimo (promoted:true). A causa era o workspace nascer de um "snapshot" que capturava
    // TUDO fisicamente presente no ROOT — corrigido materializando o workspace diretamente do
    // HEAD real e imutável.
    const dirtyFile = path.join(REPO_ROOT, 'dirty-local-untracked-test.txt');
    fs.writeFileSync(dirtyFile, 'isto NUNCA pode ser promovido\n');
    createdUntrackedFiles.push(dirtyFile);

    const taskId = `jest-seal-001-untracked-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    const result = await promoteValidatedPatch({
      taskId,
      attemptId: 'jest-seal-001-untracked-attempt',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'seal-001 dirty untracked never promoted',
    });
    if (result.promoted) createdBranches.push(candidateBranchName(taskId));

    // DIAGNÓSTICO (2026-10-20): sob carga (bateria em --maxWorkers=2) a promoção reprovou em silêncio
    // e a mensagem padrão `Expected: true, Received: false` não dizia QUAL etapa falhou. Incluir o
    // `code` na asserção não afrouxa nada (continua exigindo promoted=true) e torna a falha acionável.
    expect({ promoted: result.promoted, code: result.code || null }).toEqual({ promoted: true, code: null });
    expect(result.evidence.validatedChangedPaths).toEqual([FIXTURE_FILE]);
    expect(result.evidence.promotedChangedPaths).toEqual([FIXTURE_FILE]);

    const changed = execFileSync('git', ['diff', '--name-status', result.evidence.targetCommit, result.evidence.candidateCommit], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(changed).not.toContain('dirty-local-untracked-test.txt');
    expect(changed.trim()).toBe(`M\t${FIXTURE_FILE}`);
  });

  test('achado real: modificação unstaged de um arquivo já rastreado NUNCA aparece no candidate promovido', async () => {
    const unstagedFile = 'tests/fixtures/engineering-router-sandbox/printHardcodedSecretProbe.js';
    fs.appendFileSync(path.join(REPO_ROOT, unstagedFile), '\n// modificação unstaged local, nunca deve ser promovida (ER-V1-SEAL-001)\n');

    const taskId = `jest-seal-001-unstaged-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    const result = await promoteValidatedPatch({
      taskId,
      attemptId: 'jest-seal-001-unstaged-attempt',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'seal-001 dirty unstaged never promoted',
    });
    if (result.promoted) createdBranches.push(candidateBranchName(taskId));

    expect(result.promoted).toBe(true);
    const changed = execFileSync('git', ['diff', '--name-status', result.evidence.targetCommit, result.evidence.candidateCommit], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(changed).not.toContain('printHardcodedSecretProbe.js');
    expect(changed.trim()).toBe(`M\t${FIXTURE_FILE}`);
  });

  test('achado real: alteração STAGED (git add sem commit) de um arquivo já rastreado NUNCA aparece no candidate promovido', async () => {
    const stagedFile = 'tests/fixtures/engineering-router-sandbox/writeOutsideWorkspaceProbe.js';
    fs.appendFileSync(path.join(REPO_ROOT, stagedFile), '\n// modificação staged local, nunca deve ser promovida (ER-V1-SEAL-001)\n');
    execFileSync('git', ['add', stagedFile], { cwd: REPO_ROOT });

    const taskId = `jest-seal-001-staged-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    const result = await promoteValidatedPatch({
      taskId,
      attemptId: 'jest-seal-001-staged-attempt',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'seal-001 dirty staged never promoted',
    });
    if (result.promoted) createdBranches.push(candidateBranchName(taskId));

    expect(result.promoted).toBe(true);
    const changed = execFileSync('git', ['diff', '--name-status', result.evidence.targetCommit, result.evidence.candidateCommit], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(changed).not.toContain('writeOutsideWorkspaceProbe.js');
    expect(changed.trim()).toBe(`M\t${FIXTURE_FILE}`);
  });

  test('todas as três formas de dirty state simultaneamente (untracked + unstaged + staged) — candidate contém SOMENTE o patch da task', async () => {
    const untrackedFile = path.join(REPO_ROOT, 'dirty-local-combined-test.txt');
    fs.writeFileSync(untrackedFile, 'untracked — nunca promover\n');
    createdUntrackedFiles.push(untrackedFile);

    const unstagedFile = 'tests/fixtures/engineering-router-sandbox/printHardcodedSecretProbe.js';
    fs.appendFileSync(path.join(REPO_ROOT, unstagedFile), '\n// unstaged combinado — nunca promover\n');

    const stagedFile = 'tests/fixtures/engineering-router-sandbox/writeOutsideWorkspaceProbe.js';
    fs.appendFileSync(path.join(REPO_ROOT, stagedFile), '\n// staged combinado — nunca promover\n');
    execFileSync('git', ['add', stagedFile], { cwd: REPO_ROOT });

    const taskId = `jest-seal-001-combined-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    createdWorkspaces.push(workspace);

    const applyResult = await applyPatch(workspace, FIX_DIFF);
    expect(applyResult.ok).toBe(true);

    const result = await promoteValidatedPatch({
      taskId,
      attemptId: 'jest-seal-001-combined-attempt',
      attemptNumber: 1,
      workspacePath: workspace,
      diff: FIX_DIFF,
      testCommands: [FIXTURE_TEST_COMMAND],
      taskTitle: 'seal-001 dirty combined never promoted',
    });
    if (result.promoted) createdBranches.push(candidateBranchName(taskId));

    expect(result.promoted).toBe(true);
    const changed = execFileSync('git', ['diff', '--name-status', result.evidence.targetCommit, result.evidence.candidateCommit], { cwd: REPO_ROOT, encoding: 'utf8' });
    // 0 contaminações: candidate contém SOMENTE o arquivo do patch da task.
    expect(changed.trim()).toBe(`M\t${FIXTURE_FILE}`);
  });
});
