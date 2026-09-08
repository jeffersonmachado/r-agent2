'use strict';

/**
 * Testes do script de tag imutável de release (scripts/create-release-tag.sh)
 * contra um repo git temporário com remote BARE local (sem rede):
 *
 *   - tag nova → criada (anotada) e pushada, target == commit;
 *   - re-run com o mesmo commit → idempotente, sucesso sem recriar;
 *   - tag existente apontando para OUTRO commit → RELEASE_TAG_CONFLICT (exit 1);
 *   - commit default resolvido do dist/release/*.manifest.json mais recente.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'create-release-tag.sh');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function runScript(cwd, args) {
  const result = spawnSync('bash', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return {
    status: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function remoteTagTarget(work, tag) {
  // ls-remote do remote bare; deref ^{} tem prioridade (tag anotada).
  const out = git(work, ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  let target = null;
  for (const line of out.split('\n').filter(Boolean)) {
    const [sha, ref] = line.split('\t');
    if (ref === `refs/tags/${tag}^{}`) target = sha;
    else if (ref === `refs/tags/${tag}` && !target) target = sha;
  }
  return target;
}

describe('create-release-tag.sh — tag imutável de release (repo temporário, remote bare)', () => {
  let dir;
  let work;
  let commit1;
  let commit2;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-release-tag-'));
    execFileSync('git', ['init', '--bare', path.join(dir, 'remote.git')], { stdio: 'ignore' });
    work = path.join(dir, 'work');
    execFileSync('git', ['init', work], { stdio: 'ignore' });
    git(work, ['config', 'user.email', 'qa@example.com']);
    git(work, ['config', 'user.name', 'QA Bot']);
    fs.writeFileSync(path.join(work, 'file.txt'), 'v1\n');
    git(work, ['add', 'file.txt']);
    git(work, ['commit', '-m', 'commit 1']);
    commit1 = git(work, ['rev-parse', 'HEAD']);
    git(work, ['remote', 'add', 'origin', path.join(dir, 'remote.git')]);
    git(work, ['push', 'origin', 'HEAD:refs/heads/main']);
    fs.writeFileSync(path.join(work, 'file.txt'), 'v2\n');
    git(work, ['add', 'file.txt']);
    git(work, ['commit', '-m', 'commit 2']);
    commit2 = git(work, ['rev-parse', 'HEAD']);
    git(work, ['push', 'origin', 'HEAD:refs/heads/main']);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('tag nova → tag anotada criada e pushada, target == commit', () => {
    const result = runScript(work, ['rel-1', commit1]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('tag anotada rel-1 criada');
    expect(remoteTagTarget(work, 'rel-1')).toBe(commit1);
    // Tag ANOTADA: o objeto local é do tipo 'tag', não 'commit'.
    expect(git(work, ['cat-file', '-t', 'refs/tags/rel-1'])).toBe('tag');
  });

  test('re-run com o mesmo commit → idempotente (exit 0, sem recriar)', () => {
    const result = runScript(work, ['rel-1', commit1]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('idempotente');
    expect(remoteTagTarget(work, 'rel-1')).toBe(commit1);
  });

  test('tag existente apontando para OUTRO commit → RELEASE_TAG_CONFLICT (exit 1)', () => {
    const result = runScript(work, ['rel-1', commit2]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('RELEASE_TAG_CONFLICT');
    // Tag remota intacta (imutável): ainda aponta para o commit original.
    expect(remoteTagTarget(work, 'rel-1')).toBe(commit1);
  });

  test('commit omitido → resolvido do dist/release/*.manifest.json mais recente', () => {
    const releaseDir = path.join(work, 'dist', 'release');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(releaseDir, 'r-agent2-20260908-000000.manifest.json'),
      JSON.stringify({ git_commit: commit2 }),
    );
    const result = runScript(work, ['rel-2']);
    expect(result.status).toBe(0);
    expect(result.output).toContain(`commit resolvido do manifest`);
    expect(remoteTagTarget(work, 'rel-2')).toBe(commit2);
  });

  test('conflito LOCAL: tag local em outro commit (remote sem a tag) → RELEASE_TAG_CONFLICT', () => {
    git(work, ['tag', '-a', 'rel-3', commit1, '-m', 'tag local conflitante']);
    const result = runScript(work, ['rel-3', commit2]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('RELEASE_TAG_CONFLICT');
  });

  test('commit malformado → exit 1', () => {
    const result = runScript(work, ['rel-4', 'abc123']);
    expect(result.status).toBe(1);
    expect(result.output).toContain('malformado');
  });
});
