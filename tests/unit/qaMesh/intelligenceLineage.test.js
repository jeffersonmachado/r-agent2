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

function writeIntelligence(execution, { arquivoPreExistente = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-intel-'));
  if (arquivoPreExistente) {
    fs.writeFileSync(
      path.join(dir, 'latest.json'),
      `${JSON.stringify(arquivoPreExistente, null, 2)}\n`,
      'utf8'
    );
  }
  buildFailureIntelligence(execution, [], { outputDir: dir });
  const ler = (nome) => {
    const alvo = path.join(dir, nome);
    return fs.existsSync(alvo) ? JSON.parse(fs.readFileSync(alvo, 'utf8')) : null;
  };
  const escrito = { governado: ler('latest.json'), naoGovernado: ler('latest-ungoverned.json') };
  fs.rmSync(dir, { recursive: true, force: true });
  return escrito;
}

describe('qa-mesh intelligence/latest.json — lineage na origem (T26)', () => {
  it('artefato nasce com runId/sourceFingerprint do execution (run governado)', () => {
    const { governado: written } = writeIntelligence({ executionId: 'mesh-t26', results: [], ...LINEAGE });
    expect(written.runId).toBe(LINEAGE.runId);
    expect(written.sourceFingerprint).toBe(LINEAGE.sourceFingerprint);
    expect(written.sourceCommit).toBe(LINEAGE.sourceCommit);
    expect(written.sourceTree).toBe(LINEAGE.sourceTree);
    expect(written.generatedAt).toBeTruthy();
    expect(written.isGovernedEvidence).toBe(true);
  });

  it('artefato nasce com artifactType/artifactVersion (contrato do scorecard)', () => {
    const { governado: written } = writeIntelligence({ executionId: 'mesh-t26', results: [], ...LINEAGE });
    expect(written.artifactType).toBeTruthy();
    expect(written.artifactVersion).toBeTruthy();
  });

  it('fora de run governado os campos nascem null — nunca inventados', () => {
    const { naoGovernado: written } = writeIntelligence({ executionId: 'mesh-t26', results: [] });
    expect(written).not.toBeNull();
    expect(written.runId).toBeNull();
    expect(written.sourceFingerprint).toBeNull();
    expect(written.isGovernedEvidence).toBe(false);
  });

  it('execucao SEM lineage NAO escreve no caminho da evidencia governada', () => {
    // DEFEITO MEDIDO (2026-10-16): uma execucao manual da malha (sem
    // GOVERNANCE_RUN_ID/GOVERNANCE_SOURCE_FINGERPRINT) sobrescrevia
    // qa-mesh/intelligence/latest.json com lineage nulo e derrubava o agregado
    // com QA_EVIDENCE_LINEAGE_MISSING — acao de desenvolvedor envenenando
    // evidencia governada. Agora: quem nao tem lineage escreve em
    // latest-ungoverned.json e o artefato governado e PRESERVADO.
    const GOVERNADO = {
      runId: 'rap-governed-anterior',
      sourceFingerprint: 'c'.repeat(64),
      isGovernedEvidence: true,
    };
    const { governado, naoGovernado } = writeIntelligence(
      { executionId: 'mesh-t26', results: [] },
      { arquivoPreExistente: GOVERNADO }
    );
    expect(governado).toEqual(GOVERNADO);
    expect(naoGovernado.executionId).toBe('mesh-t26');
    expect(naoGovernado.isGovernedEvidence).toBe(false);
  });
});
