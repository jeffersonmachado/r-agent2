'use strict';

/**
 * Contrato entre LIMPADOR e PRODUTOR da prova de limpeza.
 *
 * Defeito medido no selo de 2026-10-19 (`seal-time-gate` → `SEAL_NO_GO`):
 * `governance/cleanup-proof.json` saía com `workspaceClean: false` e
 * `workspaceArtifacts: ["test-results"]`, o proof engine marcava
 * `cleanup_status` como ausente (`governance/proof-engine/index.js`: exige
 * `runtimeClean === true && workspaceClean === true`) e o gap
 * `gap-proof-governance-support` ficava aberto para sempre — nenhum selo
 * fechava.
 *
 * Causa: o PRODUTOR da prova verificava `test-results` na raiz, mas o
 * LIMPADOR (`scripts/clean-runtime-state.sh`) não removia esse caminho.
 * Cada lado estava internamente "correto"; a divergência entre eles é que
 * tornava o gate insatisfazível.
 *
 * Este teste trava a coerência: todo caminho que o produtor considera resíduo
 * de workspace PRECISA estar na lista que o limpador remove.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const CLEANER = path.join(ROOT, 'scripts', 'clean-runtime-state.sh');
const PRODUCER = path.join(ROOT, 'governance', 'materialize-proof-artifacts.js');

function caminhosDoLimpador() {
  const content = fs.readFileSync(CLEANER, 'utf8');
  // Bloco RUNTIME_DIRS=( "a" "b" ... )
  const block = content.match(/RUNTIME_DIRS=\(([\s\S]*?)\)\s*\n/);
  if (!block) throw new Error('RUNTIME_DIRS não encontrado no limpador');
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function caminhosDoProdutor() {
  const content = fs.readFileSync(PRODUCER, 'utf8');
  const block = content.match(/const workspaceArtifacts = \[([\s\S]*?)\]\.filter/);
  if (!block) throw new Error('lista workspaceArtifacts não encontrada no produtor');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('cleanup-proof: limpador e produtor cobrem os MESMOS resíduos', () => {
  test('todo caminho verificado pelo produtor é removido pelo limpador', () => {
    const limpador = caminhosDoLimpador();
    const produtor = caminhosDoProdutor();

    expect(produtor.length).toBeGreaterThan(0);
    const naoCobertos = produtor.filter((p) => !limpador.includes(p));
    expect(naoCobertos).toEqual([]);
  });

  test('`test-results` da raiz está coberto (defeito medido)', () => {
    expect(caminhosDoProdutor()).toContain('test-results');
    expect(caminhosDoLimpador()).toContain('test-results');
  });

  test('prova de limpeza existente declara os campos que o gate exige', () => {
    const proofPath = path.join(ROOT, 'governance', 'cleanup-proof.json');
    if (!fs.existsSync(proofPath)) return; // prova é produzida no converge
    const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
    expect(typeof proof.runtimeClean).toBe('boolean');
    expect(typeof proof.workspaceClean).toBe('boolean');
    expect(Array.isArray(proof.workspaceArtifacts)).toBe(true);
    // Se declarar sujo, precisa dizer O QUE está sujo (diagnóstico).
    if (proof.workspaceClean === false) {
      expect(proof.workspaceArtifacts.length).toBeGreaterThan(0);
    }
  });
});
