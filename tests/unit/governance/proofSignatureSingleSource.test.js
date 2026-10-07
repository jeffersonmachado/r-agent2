'use strict';

/**
 * PRODUTOR E CONSUMIDOR DA MESMA PROVA TÊM DE LER A MESMA CÓPIA.
 *
 * DEFEITO MEDIDO (2026-10-06, empacotamento do RUN A):
 *   qa/qa-waves-enterprise-governance.json existe em DUAS cópias — a do runtime
 *   root (~/.local/share/ragent2-runtime/qa/…) e o espelho no workspace, que é o
 *   que VAI NO PAYLOAD. O bridge escreve as duas; `resolveEvidenceCandidates`
 *   prefere a do runtime. `governance/materialize-proof-artifacts.js` usava esse
 *   resolvedor e gravava `governance/proof-signature.json` a partir da cópia do
 *   RUNTIME, enquanto `governance/replay-integrity.js` confere a cópia do
 *   WORKSPACE. Quando as duas divergem (medido: runtime reportHash 94b46d59…,
 *   workspace 2f0cb027…) o pacote morre em
 *     proof_report_hash_mismatch + proof_enterprise_signature_mismatch
 *   — falha CRÍTICA do replay integrity, com a release bloqueada.
 *
 * O teste trava a autoridade: para artefato EMPACOTADO, o produtor da prova lê a
 * cópia do workspace (a mesma que o consumidor e o payload carregam).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const MATERIALIZER = path.join(ROOT, 'governance', 'materialize-proof-artifacts.js');
const REPLAY_INTEGRITY = path.join(ROOT, 'governance', 'replay-integrity.js');

describe('proof-signature — fonte única para artefato empacotado', () => {
  const materializer = fs.readFileSync(MATERIALIZER, 'utf8');

  test('o relatório de governança empacotado é lido da cópia do WORKSPACE', () => {
    expect(materializer).toMatch(/function readJsonFromWorkspace/);
    expect(materializer).toMatch(/readJsonFromWorkspace\('qa\/qa-waves-enterprise-governance\.json'\)/);
    // E não pelo resolvedor com preferência de runtime root.
    expect(materializer).not.toMatch(/readJsonFromCandidates\('qa\/qa-waves-enterprise-governance\.json'\)/);
  });

  test('o consumidor confere a cópia do workspace (as duas pontas coincidem)', () => {
    const consumer = fs.readFileSync(REPLAY_INTEGRITY, 'utf8');
    // replay-integrity lê ROOT/qa/qa-waves-enterprise-governance.json (workspace).
    expect(consumer).toMatch(/qa-waves-enterprise-governance\.json/);
    expect(consumer).not.toMatch(/resolveEvidenceCandidates\(\s*ROOT,\s*'qa\/qa-waves-enterprise-governance\.json'/);
  });

  test('o proof-signature copia hash+assinatura do MESMO relatório que declara', () => {
    const buildStart = materializer.indexOf('function buildGovernanceArtifacts');
    expect(buildStart).toBeGreaterThan(-1);
    const build = materializer.slice(buildStart, materializer.indexOf('\n}', buildStart));
    expect(build).toMatch(/sourceArtifact:\s*'qa\/qa-waves-enterprise-governance\.json'/);
    expect(build).toMatch(/signature:\s*governanceReport\.enterpriseGovernanceSignature/);
    expect(build).toMatch(/reportHash:\s*governanceReport\.reportHash/);
  });
});
