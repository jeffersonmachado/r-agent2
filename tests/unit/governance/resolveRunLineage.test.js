'use strict';

/**
 * Testes do resolvedor de lineage NA ORIGEM.
 *
 * O defeito real (2026-09-19) foi adotar lineage DEPOIS: o relatório do QA Mesh
 * de 10:46 recebeu o runId de um run de 20:18. A correção exige que a
 * identidade exista ANTES do produtor executar. Estes testes travam:
 *   - env explícito vence;
 *   - `.current-run.json` é usado quando não há env;
 *   - sem run, devolve `none` e NUNCA inventa identidade.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CURRENT_RUN_RELATIVE_PATH,
  resolveRunLineage,
  toLineageEnv,
} = require('../../../scripts/governance/lib/resolve-run-lineage');

const RUN_ID = 'rap-governed-20260919120000000-abcdef12';
const FINGERPRINT = 'a'.repeat(64);

function makeRoot(currentRun) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-lineage-'));
  if (currentRun !== undefined) {
    const target = path.join(root, CURRENT_RUN_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof currentRun === 'string' ? currentRun : JSON.stringify(currentRun), 'utf8');
  }
  return root;
}

describe('resolve-run-lineage (lineage na origem)', () => {
  const roots = [];
  afterEach(() => {
    while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
  });

  it('usa o env explícito do orquestrador quando presente', () => {
    const root = makeRoot({ runId: 'outro-run', sourceFingerprint: 'b'.repeat(64) });
    roots.push(root);

    const lineage = resolveRunLineage({
      rootDir: root,
      env: {
        GOVERNANCE_RUN_ID: RUN_ID,
        GOVERNANCE_SOURCE_FINGERPRINT: FINGERPRINT,
        GOVERNANCE_SOURCE_COMMIT: 'c'.repeat(40),
        GOVERNANCE_SOURCE_TREE: 'd'.repeat(40),
      },
    });

    expect(lineage.source).toBe('env');
    expect(lineage.runId).toBe(RUN_ID);
    expect(lineage.sourceFingerprint).toBe(FINGERPRINT);
    expect(lineage.sourceCommit).toBe('c'.repeat(40));
    expect(lineage.sourceTree).toBe('d'.repeat(40));
  });

  it('cai para .current-run.json quando não há env', () => {
    const root = makeRoot({ runId: RUN_ID, sourceFingerprint: FINGERPRINT });
    roots.push(root);

    const lineage = resolveRunLineage({ rootDir: root, env: {} });

    expect(lineage.source).toBe('current-run-file');
    expect(lineage.runId).toBe(RUN_ID);
    expect(lineage.sourceFingerprint).toBe(FINGERPRINT);
  });

  it('devolve none (sem inventar identidade) quando não há run', () => {
    const root = makeRoot(undefined);
    roots.push(root);

    const lineage = resolveRunLineage({ rootDir: root, env: {} });

    expect(lineage.source).toBe('none');
    expect(lineage.runId).toBeNull();
    expect(lineage.sourceFingerprint).toBeNull();
    expect(toLineageEnv(lineage)).toEqual({});
  });

  it('devolve none quando o env traz só metade do lineage', () => {
    const root = makeRoot(undefined);
    roots.push(root);

    const lineage = resolveRunLineage({
      rootDir: root,
      env: { GOVERNANCE_RUN_ID: RUN_ID },
    });

    expect(lineage.source).toBe('none');
    expect(lineage.runId).toBeNull();
  });

  it('devolve none quando .current-run.json está corrompido', () => {
    const root = makeRoot('{ isso não é json');
    roots.push(root);

    const lineage = resolveRunLineage({ rootDir: root, env: {} });

    expect(lineage.source).toBe('none');
  });

  it('toLineageEnv omite campos nulos e não gera chaves vazias', () => {
    const lineage = resolveRunLineage({
      rootDir: makeRoot(undefined),
      env: { GOVERNANCE_RUN_ID: RUN_ID, GOVERNANCE_SOURCE_FINGERPRINT: FINGERPRINT },
    });
    const env = toLineageEnv(lineage);
    expect(env).toEqual({
      GOVERNANCE_RUN_ID: RUN_ID,
      GOVERNANCE_SOURCE_FINGERPRINT: FINGERPRINT,
    });
    expect('GOVERNANCE_SOURCE_COMMIT' in env).toBe(false);
  });
});
