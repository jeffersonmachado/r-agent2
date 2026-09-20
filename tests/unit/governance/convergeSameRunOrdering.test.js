'use strict';

/**
 * T17 — ordem da evidência same-run dentro da convergência. Defeito medido em
 * 2026-09-20 (run rap-governed-20260920040310055): o seal-time-gate avaliava o
 * scorecard do run novo ANTES do QA Mesh/enterprise proof executarem nele —
 * RAP-024/026/068 como FOREIGN_RUN_ARTIFACT (falha "real") → SEAL_NO_GO e o
 * mesh nunca rodava (deadlock). Em paralelo, três relatórios derivados
 * (system-scope-audit, agent-policy-compliance, replay-hardening) cruzaram o
 * maxAgeMs de 7d do registry → ARTIFACT_EXPIRED, porque a convergência não os
 * regerava (stamp não pode refrescar generatedAt — seria freshness fabricada).
 *
 * Ordem canônica (missão 2026-09-19): CREATE RUN → QA Mesh → demais evidências
 * → scorecard → seal-time-gate. Este teste trava a ordem no script.
 */

const fs = require('fs');
const path = require('path');

const CONVERGE = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'converge-governance.sh'),
  'utf8',
);

function indexOf(needle) {
  const idx = CONVERGE.indexOf(needle);
  if (idx === -1) throw new Error(`passo ausente no converge: ${needle}`);
  return idx;
}

describe('converge-governance.sh — ordem canônica da evidência same-run', () => {
  it('enterprise proof (RUNTIME_EVIDENCE qa/enterprise/*) executa ANTES do critical-journey que o consome', () => {
    expect(indexOf('qa-waves-enterprise-proof-smoke.js')).toBeLessThan(
      indexOf('generate-critical-journey-evidence-v2.js'),
    );
  });

  it('QA Mesh executa DENTRO da convergência, ANTES do stamp e do scorecard', () => {
    const mesh = indexOf('npm run qa:mesh');
    expect(mesh).toBeLessThan(indexOf('stamp-report-lineage.js'));
    expect(mesh).toBeLessThan(indexOf('run-persisted-scorecard.js'));
  });

  it('mesh executa com origem de pipeline canônica (executionOrigin=pipeline)', () => {
    expect(CONVERGE).toMatch(/RUNNING_IN_PIPELINE=1[^\n]*npm run qa:mesh/);
  });

  it('relatórios derivados com TTL de 7d são REGERADOS pelo produtor real (nunca só estampados)', () => {
    for (const producer of [
      'generate-system-scope-audit.js',
      'verify-agent-policy-compliance.js',
      'replay-hardening-engine.js',
    ]) {
      expect(indexOf(producer)).toBeLessThan(indexOf('stamp-report-lineage.js'));
    }
  });

  it('seal-time-gate continua sendo a ÚLTIMA etapa (avalia evidência já same-run)', () => {
    expect(indexOf('seal-time-gate.js')).toBeGreaterThan(indexOf('run-persisted-scorecard.js'));
  });
});
