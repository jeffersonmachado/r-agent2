'use strict';

/**
 * Testes do gate DIRTY_WORKTREE (scripts/governance/check-clean-worktree.js):
 * release oficial exige `git status --porcelain` vazio no snapshot inicial —
 * o pacote precisa corresponder exatamente ao gitCommit declarado no manifest.
 * Usa repositórios git temporários; nunca toca no repo real.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { checkCleanWorktree } = require('../../../scripts/governance/check-clean-worktree');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'check-clean-worktree.js');

function git(dir, args) {
  return String(execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) || '').trim();
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-worktree-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'qa@example.com']);
  git(dir, ['config', 'user.name', 'QA']);
  fs.writeFileSync(path.join(dir, 'source.js'), "'use strict';\nmodule.exports = 1;\n");
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

describe('check-clean-worktree (gate DIRTY_WORKTREE)', () => {
  let dir;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  test('worktree limpo → PASS com proveniência completa', () => {
    dir = makeRepo();
    const result = checkCleanWorktree(dir);
    expect(result.clean).toBe(true);
    expect(result.code).toBe('CLEAN_WORKTREE');
    expect(result.changes).toEqual([]);
    expect(result.provenance.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.provenance.tree).toMatch(/^[0-9a-f]{40}$/);
    expect(result.provenance.branch).toBe('main');
  });

  test('arquivo tracked modificado → NO_GO DIRTY_WORKTREE', () => {
    dir = makeRepo();
    fs.appendFileSync(path.join(dir, 'source.js'), '// drift não commitado\n');
    const result = checkCleanWorktree(dir);
    expect(result.clean).toBe(false);
    expect(result.code).toBe('DIRTY_WORKTREE');
    expect(result.changes.map((c) => c.path)).toContain('source.js');
  });

  test('arquivo fonte untracked → NO_GO DIRTY_WORKTREE', () => {
    dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'new-source.js'), "'use strict';\n");
    const result = checkCleanWorktree(dir);
    expect(result.clean).toBe(false);
    expect(result.code).toBe('DIRTY_WORKTREE');
    expect(result.changes.map((c) => c.path)).toContain('new-source.js');
  });

  test('mudança staged (ainda não commitada) → NO_GO DIRTY_WORKTREE', () => {
    dir = makeRepo();
    fs.appendFileSync(path.join(dir, 'source.js'), '// staged\n');
    git(dir, ['add', 'source.js']);
    const result = checkCleanWorktree(dir);
    expect(result.clean).toBe(false);
    expect(result.code).toBe('DIRTY_WORKTREE');
  });

  test('diretório sem .git → GIT_REPOSITORY_REQUIRED (fail-closed)', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-worktree-nogit-'));
    expect(() => checkCleanWorktree(dir)).toThrow(/GIT_REPOSITORY_REQUIRED/);
  });

  test('CLI: exit 0 em worktree limpo e exit 1 com mensagem DIRTY_WORKTREE', () => {
    dir = makeRepo();
    const clean = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('CLEAN_WORKTREE');

    fs.appendFileSync(path.join(dir, 'source.js'), '// drift\n');
    const dirty = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8' });
    expect(dirty.status).toBe(1);
    expect(dirty.stderr).toContain('DIRTY_WORKTREE');
    expect(dirty.stderr).toContain('source.js');
  });
});
