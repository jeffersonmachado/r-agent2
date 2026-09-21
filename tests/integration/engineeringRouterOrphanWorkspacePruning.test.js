'use strict';

/**
 * ERV1-CLOSE-009 — pruning de workspace órfão.
 *
 * Se o PROCESSO morre (não uma exceção JS) no meio de uma tentativa, o `finally` que chamaria
 * `destroyWorkspace` nunca roda — o `git worktree` isolado daquela tentativa (diretório real +
 * registro no `.git/worktrees`) fica órfão para sempre. Este teste cria workspaces reais
 * (mesmo `createWorkspace` usado em produção), simula "velhice" via mtime, e prova que
 * `pruneOrphanedWorkspaces` remove de verdade os órfãos (do disco e do `git worktree list`)
 * sem tocar em workspaces recentes nem no worktree principal do repositório.
 */

const fs = require('fs');
const {
  createWorkspace,
  destroyWorkspace,
  pruneOrphanedWorkspaces,
  WORKSPACE_ROOT,
} = require('../../api/services/engineeringRouter/patchApplyService');

async function listRealWorktrees() {
  const { execFileSync } = require('child_process');
  const path = require('path');
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: path.resolve(__dirname, '..', '..'),
    encoding: 'utf8',
  });
  return out
    .split('\n\n')
    .map((block) => block.split('\n').find((l) => l.startsWith('worktree ')))
    .filter(Boolean)
    .map((l) => l.slice('worktree '.length).trim());
}

describe('ERV1-CLOSE-009 — pruneOrphanedWorkspaces remove workspaces órfãos de verdade', () => {
  jest.setTimeout(30000);
  const createdWorkspaces = [];

  afterAll(async () => {
    // Best-effort: qualquer workspace que o teste não tenha conseguido limpar sozinho.
    for (const ws of createdWorkspaces) {
      if (fs.existsSync(ws)) await destroyWorkspace(ws).catch(() => {});
    }
  });

  test('workspace "velho" (mtime antigo) é removido; workspace recente não é tocado', async () => {
    const oldWorkspace = await createWorkspace('jest-orphan-old', 1);
    const freshWorkspace = await createWorkspace('jest-orphan-fresh', 1);
    createdWorkspaces.push(oldWorkspace, freshWorkspace);

    expect(fs.existsSync(oldWorkspace)).toBe(true);
    expect(fs.existsSync(freshWorkspace)).toBe(true);

    // Simula um workspace órfão há muito tempo (processo morreu há horas).
    const oldTime = new Date(Date.now() - 3 * 60 * 60 * 1000);
    fs.utimesSync(oldWorkspace, oldTime, oldTime);

    const { pruned } = await pruneOrphanedWorkspaces({ olderThanMs: 60 * 60 * 1000 });

    expect(pruned).toContain(oldWorkspace);
    expect(pruned).not.toContain(freshWorkspace);
    expect(fs.existsSync(oldWorkspace)).toBe(false);
    expect(fs.existsSync(freshWorkspace)).toBe(true);

    const worktreesAfter = await listRealWorktrees();
    expect(worktreesAfter).not.toContain(oldWorkspace);
    expect(worktreesAfter).toContain(freshWorkspace);

    // Limpeza real do que sobrou.
    await destroyWorkspace(freshWorkspace);
  });

  test('nunca toca no worktree principal do repositório, só em workspaces sob WORKSPACE_ROOT', async () => {
    const path = require('path');
    const worktreesBefore = await listRealWorktrees();
    const mainWorktree = path.resolve(__dirname, '..', '..');
    expect(worktreesBefore).toContain(mainWorktree);

    // Nunca usar olderThanMs:0 aqui — jest roda arquivos de teste em paralelo, e outro
    // arquivo pode ter um workspace ativo real sob o mesmo WORKSPACE_ROOT neste instante;
    // um threshold de 1h só afeta o que este próprio teste backdatou deliberadamente.
    await pruneOrphanedWorkspaces({ olderThanMs: 60 * 60 * 1000 });

    const worktreesAfter = await listRealWorktrees();
    expect(worktreesAfter).toContain(mainWorktree);
    expect(fs.existsSync(mainWorktree)).toBe(true);
  });

  test('pruning é idempotente: rodar duas vezes seguidas não lança e não afeta nada novo', async () => {
    await expect(pruneOrphanedWorkspaces({ olderThanMs: 60 * 60 * 1000 })).resolves.toEqual(expect.objectContaining({ pruned: expect.any(Array) }));
    await expect(pruneOrphanedWorkspaces({ olderThanMs: 60 * 60 * 1000 })).resolves.toEqual(expect.objectContaining({ pruned: expect.any(Array) }));
  });
});
