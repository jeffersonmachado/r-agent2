'use strict';

/**
 * ER-V1-FINAL-010 (Self-Proving Audit Envelope) — gerador REAL (a partir da evidência de
 * runtime/estrutural real já no disco) + verifier REAL sobre o output, ponta a ponta.
 *
 * Requer `reports/engineering-router-v1-runtime-evidence.json` e
 * `reports/engineering-router-v1-report.json` frescos (mesmo sourceFingerprint da working tree
 * atual, status RUNTIME_PASS/PASS) — produzidos por
 * `node scripts/governance/collect-engineering-router-runtime-evidence.js` seguido de
 * `node scripts/governance/validate-engineering-router-v1.js --runtime`. Se ausentes/obsoletos,
 * pula explicitamente (nunca finge verde) — mesma convenção de `skipIfNoDatabase` usada em
 * outros testes de integração do Engineering Router.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJson } = require('../../scripts/governance/common');
const { computeSourceFingerprint } = require('../../governance/proof-engine/fingerprint-chain');
const { generate } = require('../../scripts/governance/generate-engineering-router-v1-audit-envelope');
const { verifyEnvelope } = require('../../scripts/governance/verify-engineering-router-v1-audit-envelope');

const ROOT = path.resolve(__dirname, '..', '..');

function freshEvidenceAvailable() {
  const runtimeEvidence = readJson('reports/engineering-router-v1-runtime-evidence.json');
  const structuralReport = readJson('reports/engineering-router-v1-report.json');
  if (!runtimeEvidence || !structuralReport) return false;
  const currentFingerprint = computeSourceFingerprint(ROOT);
  if (runtimeEvidence.sourceFingerprint !== currentFingerprint) return false;
  if (runtimeEvidence.status !== 'RUNTIME_PASS') return false;
  if (structuralReport.status !== 'PASS') return false;
  return true;
}

function skipIfNoFreshEvidence() {
  if (freshEvidenceAvailable()) return false;
  // eslint-disable-next-line no-console
  console.warn('[audit-envelope-generation] PULADO: evidência de runtime/estrutural ausente ou obsoleta — rode o coletor e o gate --runtime antes deste teste para um sinal real.');
  return true;
}

describe('ER-V1-FINAL-010 — geração real do envelope + verificação offline real', () => {
  let tmpOutDir;

  beforeEach(() => {
    tmpOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engineering-router-audit-envelope-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpOutDir, { recursive: true, force: true });
  });

  test('gera o envelope real a partir da evidência real no disco, e o verifier real confirma PASS', () => {
    if (skipIfNoFreshEvidence()) return;

    const { manifest } = generate({ outDir: tmpOutDir });

    expect(manifest.runtimeStatus).toBe('RUNTIME_PASS');
    expect(manifest.releaseStatus).toBe('ENGINEERING_ROUTER_V1_10_OF_10_GREEN');
    expect(fs.existsSync(path.join(tmpOutDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpOutDir, 'hashes.json'))).toBe(true);

    const result = verifyEnvelope(tmpOutDir);
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('gerar sem evidência de runtime fresca falha explicitamente (nunca certifica silenciosamente)', () => {
    const missingReportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engineering-router-audit-envelope-no-evidence-'));
    try {
      // Simula ausência de evidência: aponta para um ROOT vazio via override não é trivial sem
      // reescrever o módulo — em vez disso, prova a mesma garantia indiretamente: o gerador real
      // (contra o ROOT real) só chega a `RUNTIME_PASS`/`PASS` quando os dois reports existem E
      // estão frescos; corromper deliberadamente esse pré-requisito e chamar generate() deve
      // lançar, nunca produzir um envelope "otimista".
      if (skipIfNoFreshEvidence()) return;
      const reportPath = path.join(ROOT, 'reports', 'engineering-router-v1-runtime-evidence.json');
      const backup = fs.readFileSync(reportPath, 'utf8');
      try {
        const corrupted = JSON.parse(backup);
        corrupted.status = 'RUNTIME_FAIL';
        fs.writeFileSync(reportPath, JSON.stringify(corrupted));
        expect(() => generate({ outDir: missingReportsDir })).toThrow(/RUNTIME_PASS/);
      } finally {
        fs.writeFileSync(reportPath, backup);
      }
    } finally {
      fs.rmSync(missingReportsDir, { recursive: true, force: true });
    }
  });
});
