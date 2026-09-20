'use strict';

/**
 * T19 — orçamento de tempo do converge dentro do seal. Defeito medido em
 * 2026-09-20 (run rap-governed-20260920043518822-152fd644): o seal envolvia o
 * converge em `timeout 2700` (45min), mas desde o T17 o converge executa o QA
 * Mesh canônico DENTRO de si (passo 8/12, `timeout 5400` = 90min) além do
 * enterprise proof, da evidência executável e do seal-time-gate. O timeout
 * externo de 45min matava o converge no meio do mesh (~25min de mesh + ~6min
 * dos passos 1-7), orfanando o meshRunner e abortando o seal com
 * "seal-time-gate não convergiu" sem veredito.
 *
 * Invariante: o timeout externo do seal sobre o converge DEVE ser maior que o
 * timeout do passo mais longo interno (o mesh) com margem para os demais 11
 * passos. Não é "aumentar TTL de evidência": é orçamento de processo para o
 * trabalho real que a orquestração executa.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SEAL = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'seal-release.sh'), 'utf8');
const CONVERGE = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'converge-governance.sh'), 'utf8');

function convergeTimeouts() {
  const matches = [...SEAL.matchAll(/timeout\s+(\d+)\s+bash\s+scripts\/governance\/converge-governance\.sh/g)];
  if (matches.length === 0) throw new Error('seal-release.sh sem timeout sobre o converge');
  return matches.map((m) => Number(m[1]));
}

function meshTimeout() {
  const m = CONVERGE.match(/timeout\s+(\d+)\s+npm\s+run\s+qa:mesh/);
  if (!m) throw new Error('converge-governance.sh sem timeout sobre o QA Mesh');
  return Number(m[1]);
}

describe('seal-release.sh — orçamento de tempo do converge', () => {
  it('timeout externo cobre o QA Mesh (90min) + margem para os demais 11 passos', () => {
    const mesh = meshTimeout();
    for (const outer of convergeTimeouts()) {
      // Margem mínima de 30min: passos 1-7 (enterprise proof + evidência
      // executável ~10min) + 9-12 (stamp, fixpoint x2, seal-time-gate ~10min)
      // + folga para host lento.
      expect(outer).toBeGreaterThanOrEqual(mesh + 1800);
    }
  });

  it('ambas as invocações do converge (normal e self-healing) usam o mesmo orçamento', () => {
    const timeouts = convergeTimeouts();
    expect(timeouts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(timeouts).size).toBe(1);
  });
});
