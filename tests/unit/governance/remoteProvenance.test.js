'use strict';

/**
 * Testes adversariais do gate de proveniência REMOTA do release
 * (scripts/governance/verify-remote-provenance.js):
 *
 *   A. commit inexistente no remote → NO_GO RELEASE_SOURCE_COMMIT_NOT_REMOTE
 *   B. tree divergente → NO_GO RELEASE_SOURCE_TREE_MISMATCH
 *   C. tag inexistente com require-tag → NO_GO RELEASE_TAG_MISSING
 *   D. tag aponta para outro commit → NO_GO RELEASE_TAG_CONFLICT
 *   E. tudo correto (com e sem tag, tip e ancestro) → PASS
 *   F. URL de remote com credencial embutida → sanitizada no report
 *   G. remote inalcançável → FAIL REMOTE_UNREACHABLE
 *
 * O script é testado via injeção de gitRunner fake (mesmo contrato de
 * execGit: (args) => stdout, lança em falha) — sem rede, sem repo real.
 */

const path = require('path');
const {
  verifyRemoteProvenance,
  sanitizeRemoteUrl,
  parseLsRemote,
} = require('../../../scripts/governance/verify-remote-provenance');

const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const OTHER_COMMIT = 'c'.repeat(40);
const OTHER_TREE = 'd'.repeat(40);
const TAG_OBJECT = 'e'.repeat(40);
const BRANCH_TIP = 'f'.repeat(40);

function lsRemoteBody(refs) {
  return [...refs.entries()].map(([ref, sha]) => `${sha}\t${ref}`).join('\n');
}

/**
 * gitRunner fake. behavior:
 *   remoteUrl        string retornada por `git remote get-url origin`
 *   refs             Map(refname → sha) servida por `git ls-remote origin`
 *   lsRemoteFails / fetchFails  simulam remote inalcançável
 *   trees            Map(commit → tree) servida por `git rev-parse <commit>^{tree}`
 *   ancestors        array de [commit, tip] aceitos por merge-base --is-ancestor
 */
function makeFakeGit(behavior = {}) {
  const refs = behavior.refs || new Map([['refs/heads/main', COMMIT]]);
  const trees = behavior.trees || new Map([[COMMIT, TREE]]);
  const ancestors = behavior.ancestors || [];
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'remote' && args[1] === 'get-url') {
      return behavior.remoteUrl || 'https://github.com/org/r-agent2.git';
    }
    if (args[0] === 'ls-remote') {
      if (behavior.lsRemoteFails) throw new Error('could not resolve host');
      return lsRemoteBody(refs);
    }
    if (args[0] === 'fetch') {
      if (behavior.fetchFails) throw new Error('fetch failed: network unreachable');
      return '';
    }
    if (args[0] === 'merge-base') {
      const ok = ancestors.some(([commit, tip]) => commit === args[2] && tip === args[3]);
      if (!ok) throw new Error('not an ancestor');
      return '';
    }
    if (args[0] === 'rev-parse') {
      const match = String(args[1]).match(/^([0-9a-f]{40})\^\{tree\}$/);
      if (match && trees.has(match[1])) return trees.get(match[1]);
      throw new Error(`unknown revision ${args[1]}`);
    }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  runner.calls = calls;
  return runner;
}

const BASE_OPTS = { commit: COMMIT, tree: TREE, remote: 'origin' };

describe('verify-remote-provenance — cenários adversariais (gitRunner fake)', () => {
  test('A: commit inexistente no remote → NO_GO RELEASE_SOURCE_COMMIT_NOT_REMOTE', () => {
    const runner = makeFakeGit({ refs: new Map([['refs/heads/main', OTHER_COMMIT]]) });
    const result = verifyRemoteProvenance(BASE_OPTS, runner);
    expect(result.status).toBe('FAIL');
    expect(result.failureCode).toBe('RELEASE_SOURCE_COMMIT_NOT_REMOTE');
    expect(result.commitExists).toBe(false);
  });

  test('B: tree divergente → NO_GO RELEASE_SOURCE_TREE_MISMATCH', () => {
    const runner = makeFakeGit({ trees: new Map([[COMMIT, OTHER_TREE]]) });
    const result = verifyRemoteProvenance(BASE_OPTS, runner);
    expect(result.status).toBe('FAIL');
    expect(result.failureCode).toBe('RELEASE_SOURCE_TREE_MISMATCH');
    expect(result.commitExists).toBe(true);
    expect(result.treeMatches).toBe(false);
  });

  test('C: tag inexistente com require-tag → NO_GO RELEASE_TAG_MISSING', () => {
    const runner = makeFakeGit();
    const result = verifyRemoteProvenance(
      { ...BASE_OPTS, tag: 'r-agent2-20260908-000000', requireTag: true },
      runner,
    );
    expect(result.status).toBe('FAIL');
    expect(result.failureCode).toBe('RELEASE_TAG_MISSING');
  });

  test('C2: --require-tag sem --tag → NO_GO RELEASE_TAG_MISSING', () => {
    const runner = makeFakeGit();
    const result = verifyRemoteProvenance({ ...BASE_OPTS, requireTag: true }, runner);
    expect(result.status).toBe('FAIL');
    expect(result.failureCode).toBe('RELEASE_TAG_MISSING');
  });

  test('D: tag aponta para outro commit → NO_GO RELEASE_TAG_CONFLICT', () => {
    const runner = makeFakeGit({
      refs: new Map([
        ['refs/heads/main', COMMIT],
        ['refs/tags/rel-1', TAG_OBJECT],
        ['refs/tags/rel-1^{}', OTHER_COMMIT],
      ]),
    });
    const result = verifyRemoteProvenance({ ...BASE_OPTS, tag: 'rel-1' }, runner);
    expect(result.status).toBe('FAIL');
    expect(result.failureCode).toBe('RELEASE_TAG_CONFLICT');
    expect(result.tagMatches).toBe(false);
  });

  test('E1: tudo correto sem tag (modo pré-tag) → PASS, campos de tag null', () => {
    const runner = makeFakeGit();
    const result = verifyRemoteProvenance(BASE_OPTS, runner);
    expect(result.status).toBe('PASS');
    expect(result.failureCode).toBe(null);
    expect(result.commitExists).toBe(true);
    expect(result.treeMatches).toBe(true);
    expect(result.tag).toBe(null);
    expect(result.tagMatches).toBe(null);
  });

  test('E2: tudo correto com tag anotada (deref ^{} == commit) → PASS tagMatches=true', () => {
    const runner = makeFakeGit({
      refs: new Map([
        ['refs/heads/main', COMMIT],
        ['refs/tags/rel-1', TAG_OBJECT],
        ['refs/tags/rel-1^{}', COMMIT],
      ]),
    });
    const result = verifyRemoteProvenance({ ...BASE_OPTS, tag: 'rel-1', requireTag: true }, runner);
    expect(result.status).toBe('PASS');
    expect(result.tag).toBe('rel-1');
    expect(result.tagMatches).toBe(true);
  });

  test('E3: commit é ANCESTOR do tip (não o tip) → PASS via merge-base --is-ancestor', () => {
    const runner = makeFakeGit({
      refs: new Map([['refs/heads/main', BRANCH_TIP]]),
      ancestors: [[COMMIT, BRANCH_TIP]],
    });
    const result = verifyRemoteProvenance(BASE_OPTS, runner);
    expect(result.status).toBe('PASS');
    expect(result.commitExists).toBe(true);
    expect(runner.calls.some((args) => args[0] === 'merge-base' && args[2] === COMMIT && args[3] === BRANCH_TIP)).toBe(true);
  });

  test('F: URL de remote com credencial embutida → sanitizada no resultado', () => {
    const runner = makeFakeGit({ remoteUrl: 'https://ci-user:ghp_secrettoken123@github.com/org/r-agent2.git' });
    const result = verifyRemoteProvenance(BASE_OPTS, runner);
    expect(result.status).toBe('PASS');
    expect(result.remote).toBe('https://github.com/org/r-agent2.git');
    expect(JSON.stringify(result)).not.toContain('ghp_secrettoken123');
    expect(JSON.stringify(result)).not.toContain('ci-user');
  });

  test('G: remote inalcançável (ls-remote falha) → FAIL REMOTE_UNREACHABLE', () => {
    const runner = makeFakeGit({ lsRemoteFails: true });
    const result = verifyRemoteProvenance(BASE_OPTS, runner);
    expect(result.status).toBe('FAIL');
    expect(result.failureCode).toBe('REMOTE_UNREACHABLE');
  });

  test('G2: remote inalcançável (fetch falha) → FAIL REMOTE_UNREACHABLE', () => {
    const runner = makeFakeGit({ fetchFails: true });
    const result = verifyRemoteProvenance(BASE_OPTS, runner);
    expect(result.status).toBe('FAIL');
    expect(result.failureCode).toBe('REMOTE_UNREACHABLE');
  });
});

describe('verify-remote-provenance — helpers', () => {
  test('sanitizeRemoteUrl: strip de userinfo em URL https', () => {
    expect(sanitizeRemoteUrl('https://user:token@github.com/org/repo.git')).toBe('https://github.com/org/repo.git');
    expect(sanitizeRemoteUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo.git');
    expect(sanitizeRemoteUrl('git@github.com:org/repo.git')).toBe('git@github.com:org/repo.git');
  });

  test('parseLsRemote: parseia refs e ignora linhas malformadas', () => {
    const refs = parseLsRemote(`${COMMIT}\tHEAD\n${COMMIT}\trefs/heads/main\nlixo-sem-tab`);
    expect(refs.get('refs/heads/main')).toBe(COMMIT);
    expect(refs.get('HEAD')).toBe(COMMIT);
    expect(refs.size).toBe(2);
  });
});
