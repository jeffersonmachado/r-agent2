'use strict';

/**
 * Regressão do LINEAGE EXPLÍCITO (auditoria 2026-10-20).
 *
 * Antes: `report-lineage.js` pegava o run "mais recente" no banco e deixava
 * `sourceCommit` ausente sair silenciosamente do relatório. Agora a identidade
 * vem do contexto explícito e é obrigatória (fail-closed).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { lineageDoRunCorrente, comLineage } = require('../../../scripts/governance/lib/report-lineage');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lineage-'));
}

function writeContext(root, context) {
  fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governance', '.current-run.json'), JSON.stringify(context));
}

describe('report-lineage — identidade explícita obrigatória', () => {
  test('sem run explícito FALHA (nunca escolhe o mais recente)', async () => {
    const root = tmpRoot();
    await expect(lineageDoRunCorrente({ rootDir: root, env: {}, verifyDb: false }))
      .rejects.toThrow(/LINEAGE_RUN_UNDEFINED/);
  });

  test('env explícito é usado e exige fingerprint', async () => {
    const env = {
      GOVERNANCE_RUN_ID: 'run-abc',
      GOVERNANCE_SOURCE_FINGERPRINT: 'f'.repeat(64),
      GOVERNANCE_SOURCE_COMMIT: 'abc1234',
    };
    const lineage = await lineageDoRunCorrente({ rootDir: tmpRoot(), env, verifyDb: false });
    expect(lineage).toMatchObject({ runId: 'run-abc', sourceCommit: 'abc1234', source: 'env' });
  });

  test('env sem fingerprint FALHA (identidade incompleta)', async () => {
    const env = { GOVERNANCE_RUN_ID: 'run-abc' };
    await expect(lineageDoRunCorrente({ rootDir: tmpRoot(), env, verifyDb: false }))
      .rejects.toThrow(/LINEAGE_RUN_UNDEFINED/);
  });

  test('.current-run.json fornece a identidade (com sourceCommit)', async () => {
    const root = tmpRoot();
    writeContext(root, {
      runId: 'run-file',
      sourceFingerprint: 'a'.repeat(64),
      sourceCommit: 'deadbee',
    });

    const lineage = await lineageDoRunCorrente({ rootDir: root, env: {}, verifyDb: false });
    expect(lineage).toMatchObject({ runId: 'run-file', sourceCommit: 'deadbee', source: 'current-run-file' });
  });

  test('contexto sem sourceCommit e sem git FALHA', async () => {
    const root = tmpRoot();
    writeContext(root, { runId: 'run-no-commit', sourceFingerprint: 'b'.repeat(64) });
    const previous = process.env.GIT_CEILING_DIRECTORIES;
    await expect(lineageDoRunCorrente({ rootDir: root, env: {}, verifyDb: false }))
      .rejects.toThrow(/LINEAGE_SOURCE_COMMIT_ABSENT/);
    if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
  });

  test('comLineage grava runId, fingerprint e sourceCommit', async () => {
    const root = tmpRoot();
    writeContext(root, { runId: 'run-x', sourceFingerprint: 'c'.repeat(64), sourceCommit: 'feed123' });
    const out = await comLineage({ ok: true }, { rootDir: root, env: {}, verifyDb: false });
    expect(out).toMatchObject({
      ok: true,
      runId: 'run-x',
      sourceFingerprint: 'c'.repeat(64),
      sourceCommit: 'feed123',
    });
  });
});
