'use strict';

/**
 * ORDEM DA ATESTAÇÃO NO PASS 5 (P1-15, 2026-10-17).
 *
 * Defeito medido (2026-10-11): `materialize_payload_governance` reescrevia
 * membros da cadeia (`exportGovernanceArtifacts` + `package-validator`) DEPOIS da
 * atestação do PASS 4, e o `package-integrity-engine` reprovava com
 * `EVIDENCE_MANIFEST_HASH_DIVERGENT` (computed=613503798fd1…7 vs
 * recorded=deefdfdecd56…f): o pacote atestava um manifesto DIFERENTE do enviado.
 *
 * Correção: a atestação (`update-package-binding`) é RE-EMITIDA dentro da
 * materialização, depois de todas as escritas que ela precisa cobrir e antes do
 * engine de integridade. Este teste trava a ORDEM — inverter volta a quebrar o
 * release e a reprovar o pacote.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const TEXTO = fs.readFileSync(path.join(ROOT, 'scripts', 'two-pass-release.sh'), 'utf8');

/** Texto da função `materialize_payload_governance` (até a próxima função top-level). */
function materializacao() {
  const inicio = TEXTO.indexOf('materialize_payload_governance() {');
  expect(inicio).toBeGreaterThan(-1);
  const fim = TEXTO.indexOf('\nnormalize_rebound_dist_artifacts() {', inicio);
  expect(fim).toBeGreaterThan(inicio);
  return TEXTO.slice(inicio, fim);
}

const pos = (texto, agulha) => {
  const i = texto.indexOf(agulha);
  expect(i).toBeGreaterThan(-1);
  return i;
};

describe('P1-15 — atestação cobre o manifesto efetivamente enviado', () => {
  const bloco = materializacao();

  it('a re-atestação acontece DEPOIS de exportGovernanceArtifacts', () => {
    expect(pos(bloco, 'export-governance-artifacts')).toBeLessThan(pos(bloco, 'update-package-binding.js'));
  });

  it('a re-atestação acontece DEPOIS do package-validator', () => {
    expect(pos(bloco, 'package-validator.js')).toBeLessThan(pos(bloco, 'update-package-binding.js'));
  });

  it('a re-atestação acontece ANTES do package-integrity-engine (que a exige)', () => {
    expect(pos(bloco, 'update-package-binding.js')).toBeLessThan(pos(bloco, 'package-integrity-engine.js'));
  });

  it('falha da re-atestação BLOQUEIA o release (nunca segue com atestação velha)', () => {
    const i = pos(bloco, 'update-package-binding.js');
    const trecho = bloco.slice(i, i + 400);
    expect(trecho).toContain('fail');
    expect(trecho).toMatch(/atestação não cobriria o manifesto enviado/);
  });

  it('a assinatura final é re-emitida DEPOIS dos engines (H_final é a última palavra)', () => {
    const iAssinar = pos(bloco, 'Re-assinando governança contra o payload final');
    expect(iAssinar).toBeGreaterThan(pos(bloco, 'package-integrity-engine.js'));
  });
});
