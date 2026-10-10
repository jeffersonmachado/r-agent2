'use strict';

/**
 * AUTORIDADE do commit na verificação de proveniência remota.
 *
 * Achado P2 medido em 2026-10-10: sem `--manifest`, o script usava
 * `git rev-parse HEAD`. O relatório saiu com o commit `2f179545` enquanto o RUN
 * GOVERNADO declarava `sourceCommit = 4e34287f` — e o veredito
 * `RELEASE_SOURCE_COMMIT_NOT_REMOTE` ("faça push") descrevia o problema errado:
 * estava-se verificando OUTRO commit. O commit do release é o do run, não o do
 * worktree (que pode estar em outra branch, detached, ou à frente).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { verifyRemoteProvenance } = require('../../../scripts/governance/verify-remote-provenance');

const RUN_COMMIT = '1'.repeat(40);
const RUN_TREE = '2'.repeat(40);
const MANIFEST_COMMIT = '3'.repeat(40);
const MANIFEST_TREE = '4'.repeat(40);
const HEAD_COMMIT = '5'.repeat(40);
const HEAD_TREE = '6'.repeat(40);

function tmpRoot({ currentRun = null, manifest = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));
  fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
  if (currentRun) {
    fs.writeFileSync(
      path.join(dir, 'governance', '.current-run.json'),
      JSON.stringify(currentRun, null, 2),
    );
  }
  if (manifest) {
    const manifestPath = path.join(dir, 'release.manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return { dir, manifestPath };
  }
  return { dir, manifestPath: null };
}

/** Runner mínimo: só responde o que o gate consulta. */
function makeRunner({ remoteCommit, remoteTree }) {
  const calls = [];
  const runner = (args) => {
    calls.push(args.join(' '));
    const joined = args.join(' ');
    if (joined === 'remote get-url origin') return 'https://github.com/org/r-agent2.git';
    if (args[0] === 'ls-remote') return `${remoteCommit}\trefs/heads/main`;
    if (args[0] === 'fetch') return '';
    if (joined === `rev-parse ${remoteCommit}^{tree}`) return remoteTree;
    if (joined === 'rev-parse HEAD') return HEAD_COMMIT;
    if (joined === 'rev-parse HEAD^{tree}') return HEAD_TREE;
    throw new Error(`chamada git inesperada: ${joined}`);
  };
  runner.calls = calls;
  return runner;
}

describe('verify-remote-provenance — o commit do RELEASE vem do run governado', () => {
  test('sem manifest: usa `sourceCommit` do run, e NÃO consulta o HEAD', () => {
    const { dir } = tmpRoot({
      currentRun: { runId: 'rap-1', sourceCommit: RUN_COMMIT, sourceTree: RUN_TREE },
    });
    const runner = makeRunner({ remoteCommit: RUN_COMMIT, remoteTree: RUN_TREE });

    const result = verifyRemoteProvenance({ rootDir: dir, remote: 'origin' }, runner);

    expect(result).toMatchObject({
      status: 'PASS',
      commit: RUN_COMMIT,
      commitSource: 'current-run',
      commitExists: true,
      treeMatches: true,
    });
    expect(runner.calls).not.toContain('rev-parse HEAD');
  });

  test('run cujo commit NÃO está no remote: o veredito aponta o commit do run (não o HEAD)', () => {
    const { dir } = tmpRoot({
      currentRun: { runId: 'rap-1', sourceCommit: RUN_COMMIT, sourceTree: RUN_TREE },
    });
    const runner = makeRunner({ remoteCommit: HEAD_COMMIT, remoteTree: HEAD_TREE });

    const result = verifyRemoteProvenance({ rootDir: dir, remote: 'origin' }, runner);

    expect(result.status).toBe('FAIL');
    expect(result.failureCode).toBe('RELEASE_SOURCE_COMMIT_NOT_REMOTE');
    // O commit verificado é o do run: é sobre ELE que "faça push" faz sentido.
    expect(result.commit).toBe(RUN_COMMIT);
    expect(result.commitSource).toBe('current-run');
  });

  test('manifest tem precedência sobre o run (é o artefato do release)', () => {
    const { dir, manifestPath } = tmpRoot({
      currentRun: { runId: 'rap-1', sourceCommit: RUN_COMMIT, sourceTree: RUN_TREE },
      manifest: { git_commit: MANIFEST_COMMIT, git_tree: MANIFEST_TREE },
    });
    const runner = makeRunner({ remoteCommit: MANIFEST_COMMIT, remoteTree: MANIFEST_TREE });

    const result = verifyRemoteProvenance({ rootDir: dir, remote: 'origin', manifestPath }, runner);

    expect(result).toMatchObject({
      status: 'PASS',
      commit: MANIFEST_COMMIT,
      commitSource: 'manifest',
    });
  });

  test('sem run e sem manifest: comportamento anterior preservado (HEAD)', () => {
    const { dir } = tmpRoot();
    const runner = makeRunner({ remoteCommit: HEAD_COMMIT, remoteTree: HEAD_TREE });

    const result = verifyRemoteProvenance({ rootDir: dir, remote: 'origin' }, runner);

    expect(result).toMatchObject({ status: 'PASS', commit: HEAD_COMMIT, commitSource: 'head' });
    expect(runner.calls).toContain('rev-parse HEAD');
  });

  test('`--commit` explícito vence tudo (e é declarado como flag)', () => {
    const { dir } = tmpRoot({
      currentRun: { runId: 'rap-1', sourceCommit: RUN_COMMIT, sourceTree: RUN_TREE },
    });
    const runner = makeRunner({ remoteCommit: HEAD_COMMIT, remoteTree: HEAD_TREE });

    const result = verifyRemoteProvenance(
      { rootDir: dir, remote: 'origin', commit: HEAD_COMMIT, tree: HEAD_TREE },
      runner,
    );

    expect(result).toMatchObject({ status: 'PASS', commitSource: 'flag' });
  });
});
