'use strict';

/**
 * T26 — qa-mesh/intelligence/latest.json é RUNTIME_EVIDENCE
 * (config/runtime-evidence-artifacts.json) e precisa nascer com o lineage do
 * run governado NA ORIGEM. Defeito medido em 2026-09-20 (release
 * r-agent2-20260920-141717, fase consolidate): o gate
 * validate:qa-evidence-same-run reprovou o agregado com
 * QA_EVIDENCE_LINEAGE_MISSING — o artifact tinha generatedAt/executionId mas
 * nenhum runId/sourceFingerprint. O meshRunner já resolve o lineage na
 * origem (resolveOriginLineage) e estampa o go-no-go-report (T21); o
 * artefato de inteligência, escrito por buildFailureIntelligence, ficou de
 * fora. Stamp posterior é adoção retroativa — proibido.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildFailureIntelligence } = require('../../../qa-mesh/intelligence/failureIntelligence');

const LINEAGE = {
  runId: 'rap-governed-t26',
  sourceFingerprint: 'f'.repeat(64),
  sourceCommit: 'a'.repeat(40),
  sourceTree: 'b'.repeat(40),
};

function writeIntelligence(execution) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-intel-'));
  buildFailureIntelligence(execution, [], { outputDir: dir });
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return written;
}

describe('qa-mesh intelligence/latest.json — lineage na origem (T26)', () => {
  it('artefato nasce com runId/sourceFingerprint do execution (run governado)', () => {
    const written = writeIntelligence({ executionId: 'mesh-t26', results: [], ...LINEAGE });
    expect(written.runId).toBe(LINEAGE.runId);
    expect(written.sourceFingerprint).toBe(LINEAGE.sourceFingerprint);
    expect(written.sourceCommit).toBe(LINEAGE.sourceCommit);
    expect(written.sourceTree).toBe(LINEAGE.sourceTree);
    expect(written.generatedAt).toBeTruthy();
  });

  it('artefato nasce com artifactType/artifactVersion (contrato do scorecard)', () => {
    const written = writeIntelligence({ executionId: 'mesh-t26', results: [], ...LINEAGE });
    expect(written.artifactType).toBeTruthy();
    expect(written.artifactVersion).toBeTruthy();
  });

  it('fora de run governado os campos nascem null — nunca inventados', () => {
    const written = writeIntelligence({ executionId: 'mesh-t26', results: [] });
    expect(written.runId).toBeNull();
    expect(written.sourceFingerprint).toBeNull();
  });
});
