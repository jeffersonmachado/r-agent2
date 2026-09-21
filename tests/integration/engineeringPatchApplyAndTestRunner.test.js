'use strict';

/**
 * Integração REAL: git worktree isolado + aplicação de patch + execução de comando.
 * Sem mocks de filesystem/git — opera sobre o repositório real deste projeto, sempre em um
 * workspace isolado (nunca no working tree principal), sempre limpo ao final.
 */

const fs = require('fs');
const path = require('path');
const {
  createWorkspace, applyPatch, listChangedFiles, destroyWorkspace,
} = require('../../api/services/engineeringRouter/patchApplyService');
const { runTestCommands } = require('../../api/services/engineeringRouter/testRunnerService');

const NEW_FILE_DIFF = `diff --git a/tmp-engineering-router-fixture.txt b/tmp-engineering-router-fixture.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/tmp-engineering-router-fixture.txt
@@ -0,0 +1,2 @@
+linha 1
+linha 2
`;

const INVALID_DIFF = `diff --git a/arquivo/que/nao/existe.js b/arquivo/que/nao/existe.js
--- a/arquivo/que/nao/existe.js
+++ b/arquivo/que/nao/existe.js
@@ -1,3 +1,3 @@
 alguma linha que nao existe de verdade
-linha antiga
+linha nova
 outra linha que tambem nao existe
`;

describe('patchApplyService + testRunnerService — integração real', () => {
  jest.setTimeout(30000);

  test('cria workspace isolado, aplica patch real, roda comando e limpa tudo', async () => {
    const workspace = await createWorkspace('jest-fixture-task', 1);
    expect(fs.existsSync(workspace)).toBe(true);
    // Nunca opera no working tree principal do repositório.
    expect(workspace).not.toBe(path.resolve(__dirname, '..', '..'));

    try {
      const applyResult = await applyPatch(workspace, NEW_FILE_DIFF);
      expect(applyResult.ok).toBe(true);
      expect(fs.existsSync(path.join(workspace, 'tmp-engineering-router-fixture.txt'))).toBe(true);

      const changed = await listChangedFiles(workspace);
      expect(changed).toContain('tmp-engineering-router-fixture.txt');
      // Achado real ao validar o feed de atividade em tempo real da UI: o symlink de
      // node_modules criado por createWorkspace aparecia como "arquivo alterado" porque
      // `node_modules/` no .gitignore não casa com um symlink de mesmo nome (só com diretório
      // real) — nunca é uma mudança do patch, deve ser sempre filtrado.
      expect(changed).not.toContain('node_modules');

      const { allPass, results } = await runTestCommands({
        taskId: 'jest-fixture-task',
        attemptNumber: 1,
        commands: ['node -e "process.exit(0)"'],
        cwd: workspace,
      });
      // Comando não bate com a allowlist ("node -e ...") — deve ser REJECTED, nunca executado.
      expect(results[0].status).toBe('REJECTED');
      expect(allPass).toBe(false);
    } finally {
      await destroyWorkspace(workspace);
    }
    expect(fs.existsSync(workspace)).toBe(false);
  });

  test('patch inválido/inaplicável é rejeitado com PATCH_APPLY_FAILED, sem tocar o workspace', async () => {
    const workspace = await createWorkspace('jest-fixture-task', 2);
    try {
      const result = await applyPatch(workspace, INVALID_DIFF);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PATCH_APPLY_FAILED');
    } finally {
      await destroyWorkspace(workspace);
    }
  });

  test('comando na allowlist executa de verdade dentro do workspace e captura exitCode real', async () => {
    const workspace = await createWorkspace('jest-fixture-task', 3);
    try {
      const { allPass, results } = await runTestCommands({
        taskId: 'jest-fixture-task',
        attemptNumber: 3,
        commands: ['git status'],
        cwd: workspace,
      });
      expect(allPass).toBe(true);
      expect(results[0].status).toBe('PASS');
      expect(results[0].exitCode).toBe(0);
      expect(fs.existsSync(path.join(__dirname, '..', '..', results[0].stdoutRef))).toBe(true);
    } finally {
      await destroyWorkspace(workspace);
    }
  });

  test('comando com exitCode != 0 é reportado como FAIL real (nunca fingido como PASS)', async () => {
    const workspace = await createWorkspace('jest-fixture-task', 4);
    try {
      const { allPass, results } = await runTestCommands({
        taskId: 'jest-fixture-task',
        attemptNumber: 4,
        commands: ['node scripts/arquivo-inexistente-de-verdade-engineering-router.js'],
        cwd: workspace,
      });
      expect(allPass).toBe(false);
      expect(results[0].status).toBe('FAIL');
      expect(results[0].exitCode).not.toBe(0);
    } finally {
      await destroyWorkspace(workspace);
    }
  });
});
