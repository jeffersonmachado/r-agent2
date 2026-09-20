'use strict';

/**
 * T23a — ordem coverage gate × QA Mesh no converge. Defeito medido em
 * 2026-09-20 (run rap-governed-20260920113643242-cac6169c): o converge
 * regenera reports/coverage-gate-report.json no passo 7/12 (a suíte
 * tests/unit/coverage/coverageGate.test.js executa o produtor real
 * scripts/governance/validate-coverage-gate.js), ANTES do QA Mesh canônico
 * do passo 8/12. Os estados de jornada do coverage gate derivam dos
 * outcomes de cenário do mesh — com a ordem antiga o gate avaliou o mesh do
 * run ANTERIOR (business-core-biz-login falho no seal#8) e marcou a jornada
 * crítica journey:login FAILED, derrubando RAP-002/018/020/022/023/025/040
 * por MANDATORY_GATE_NO_GO mesmo com o mesh do run corrente GO (promovido
 * 12:15, depois do report das 11:39).
 *
 * Invariante: o produtor do coverage gate DEVE executar DEPOIS do QA Mesh
 * dentro do converge — os estados de jornada têm que ser do mesh do run
 * corrente, nunca herdados do run anterior.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const CONVERGE = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'converge-governance.sh'), 'utf8');

describe('converge-governance.sh — coverage gate depois do QA Mesh (T23a)', () => {
  it('existe refresh do coverage gate após o passo do QA Mesh', () => {
    const meshIdx = CONVERGE.indexOf('npm run qa:mesh');
    expect(meshIdx).toBeGreaterThan(-1);
    const refreshIdx = CONVERGE.indexOf('validate-coverage-gate.js', meshIdx);
    expect(refreshIdx).toBeGreaterThan(meshIdx);
  });

  it('o refresh roda o produtor real (não stamp nem edição manual)', () => {
    const meshIdx = CONVERGE.indexOf('npm run qa:mesh');
    const after = CONVERGE.slice(meshIdx);
    expect(after).toMatch(/\$NODE\s+scripts\/governance\/validate-coverage-gate\.js|node\s+scripts\/governance\/validate-coverage-gate\.js/);
  });

  it('o refresh executa antes do stamp de lineage e do fixpoint', () => {
    const meshIdx = CONVERGE.indexOf('npm run qa:mesh');
    const refreshIdx = CONVERGE.indexOf('validate-coverage-gate.js', meshIdx);
    const stampIdx = CONVERGE.indexOf('stamp-report-lineage.js', meshIdx);
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(stampIdx).toBeGreaterThan(refreshIdx);
  });
});
