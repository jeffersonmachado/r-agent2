'use strict';

/**
 * T25 — orçamento de tempo do zip:release dentro do seal. Defeito medido em
 * 2026-09-20 (run rap-governed-20260920123052954-35fa88c9): as fases candidate
 * e final do seal envolvem `npm run zip:release` em `timeout 2700` (45min),
 * mas o zip:release (two-pass) executa o converge-governance.sh COMPLETO em
 * PRE_PACKAGE — e desde o T17 o converge roda o QA Mesh canônico dentro de si
 * (~35-40min medidos) além do enterprise proof e da evidência executável.
 * O timeout de 45min matou o two-pass no meio do mesh (log do converge
 * truncado aos 14:06:50, exatos 45min após o início) e o seal falhou com
 * "candidato não selou" — mesma classe do defeito T19 (timeout externo do
 * seal sobre o converge), um nível abaixo.
 *
 * Invariante: o timeout do seal sobre o zip:release DEVE cobrir o timeout do
 * passo mais longo do converge (o mesh, 5400s) com margem para os demais
 * passos + packaging. É orçamento de processo, não TTL de evidência.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SEAL = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'seal-release.sh'), 'utf8');
const CONVERGE = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'converge-governance.sh'), 'utf8');

function zipReleaseTimeouts() {
  const matches = [...SEAL.matchAll(/timeout\s+(\d+)\s+npm\s+run\s+zip:release/g)];
  if (matches.length < 2) throw new Error('seal-release.sh deveria ter zip:release nas fases candidate e final');
  return matches.map((m) => Number(m[1]));
}

function meshTimeout() {
  const m = CONVERGE.match(/timeout\s+(\d+)\s+npm\s+run\s+qa:mesh/);
  if (!m) throw new Error('converge-governance.sh sem timeout sobre o QA Mesh');
  return Number(m[1]);
}

describe('seal-release.sh — orçamento do zip:release (T25)', () => {
  it('candidate e final cobrem o QA Mesh interno do two-pass + margem de packaging', () => {
    const mesh = meshTimeout();
    for (const outer of zipReleaseTimeouts()) {
      // Margem mínima de 30min: passos 1-7 e 8.5-12 do converge (~20min) +
      // build frontend + packaging + verify (~10min).
      expect(outer).toBeGreaterThanOrEqual(mesh + 1800);
    }
  });

  it('ambas as fases (candidate e final) usam o mesmo orçamento', () => {
    const timeouts = zipReleaseTimeouts();
    expect(new Set(timeouts).size).toBe(1);
  });
});
