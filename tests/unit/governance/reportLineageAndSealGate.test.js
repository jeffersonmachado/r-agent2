'use strict';

/**
 * Testes do report-lineage (lineage na origem) e do seal-time-gate
 * (convergência obrigatória antes de selar o payload).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { currentLineage, withLineage } = require('../../../governance/report-lineage');
const { evaluateSealState } = require('../../../scripts/governance/seal-time-gate');

const RUN_ID = 'rap-governed-20260101000000000-linetest';
const FP = 'a'.repeat(64);

function makeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-lineage-'));
  fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'governance', '.current-run.json'), JSON.stringify({
    runId: RUN_ID,
    sourceFingerprint: FP,
  }));
  return dir;
}

describe('report-lineage — lineage na origem', () => {
  let dir;
  beforeEach(() => { dir = makeRoot(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('currentLineage emite runId/sourceFingerprint/artifactType do run atual', () => {
    const lin = currentLineage('package-validation-report', { rootDir: dir });
    expect(lin.runId).toBe(RUN_ID);
    expect(lin.sourceFingerprint).toBe(FP);
    expect(lin.artifactType).toBe('package-validation-report');
    expect(lin.artifactVersion).toBeDefined();
    expect(lin.generatedAt).toBeDefined();
  });

  test('withLineage não sobrescreve campos de decisão nem lineage válido', () => {
    const report = withLineage({ ok: true, runId: 'run-original' }, 'x', { rootDir: dir });
    expect(report.ok).toBe(true);
    expect(report.runId).toBe('run-original');
    expect(report.sourceFingerprint).toBe(FP);
  });

  test('sem run governado, campos ficam null explícitos (consumidores reprovam)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-lineage-empty-'));
    const lin = currentLineage('x', { rootDir: empty });
    expect(lin.runId).toBeNull();
    expect(lin.sourceFingerprint).toBeNull();
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

// ─── seal-time-gate ───────────────────────────────────────────────────────────
function writeGov(dir, name, data) {
  fs.mkdirSync(path.join(dir, 'governance'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'governance', name), JSON.stringify(data));
}

function buildConvergedRoot(dir, overrides = {}) {
  writeGov(dir, 'rap-master-scorecard.json', overrides.scorecard || {
    dimensions: Array.from({ length: 78 }, (_, i) => ({ id: `RAP-${String(i + 1).padStart(3, '0')}`, score: 10 })),
    blockers: [], gaps: [],
  });
  writeGov(dir, 'final-governance-report.json', overrides.governance || { finalDecision: 'AUTONOMOUS_READY_GO' });
  writeGov(dir, 'final-consistency-gate-report.json', overrides.consistency || { decision: 'FINAL_CONSISTENCY_GO', pass: true });
  writeGov(dir, 'final-readiness-report.json', overrides.readiness || { finalDecision: 'AUTONOMOUS_READY_GO' });
  writeGov(dir, 'final-proof-report.json', overrides.proof || { finalDecision: 'AUTONOMOUS_READY_GO' });
  writeGov(dir, 'package-validation-report.json', overrides.pkgVal || {
    ok: true, runId: RUN_ID, sourceFingerprint: FP,
  });
  writeGov(dir, 'package-integrity-report.json', overrides.pkgInt || {
    decision: 'PACKAGE_INTEGRITY_GO', pass: true, runId: RUN_ID,
  });
}

describe('seal-time-gate — convergência antes de selar o payload', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-seal-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('SEAL_GO: tudo convergido (78/78 + engines GO + package reports com lineage)', () => {
    buildConvergedRoot(dir);
    expect(evaluateSealState(dir).decision).toBe('SEAL_GO');
  });

  test('SEAL_PENDING: apenas RAP-055/056 abaixo de 10 (fase DELIVERED)', () => {
    buildConvergedRoot(dir, {
      scorecard: {
        dimensions: Array.from({ length: 78 }, (_, i) => {
          const id = `RAP-${String(i + 1).padStart(3, '0')}`;
          return { id, score: (id === 'RAP-055' || id === 'RAP-056') ? 6 : 10 };
        }),
        blockers: [], gaps: [],
      },
      governance: { finalDecision: 'NO_GO:GOVERNANCE_BLOCKED [MASTER_SCORECARD_NOT_10_OF_10: RAP-055, RAP-056]' },
    });
    const result = evaluateSealState(dir);
    expect(result.decision).toBe('SEAL_PENDING');
    expect(result.warnings[0]).toContain('DELIVERED_PENDING');
  });

  test('SEAL_NO_GO: RAP-052 abaixo de 10 (fora da fase DELIVERED)', () => {
    buildConvergedRoot(dir, {
      scorecard: {
        dimensions: Array.from({ length: 78 }, (_, i) => ({
          id: `RAP-${String(i + 1).padStart(3, '0')}`,
          score: i === 51 ? 6 : 10,
        })),
        blockers: [], gaps: [],
      },
    });
    const result = evaluateSealState(dir);
    expect(result.decision).toBe('SEAL_NO_GO');
    expect(result.failures.join(' ')).toContain('RAP-052');
  });

  test('SEAL_NO_GO: package-validation sem lineage (root cause RAP-052/054)', () => {
    buildConvergedRoot(dir, { pkgVal: { ok: true } });
    const result = evaluateSealState(dir);
    expect(result.decision).toBe('SEAL_NO_GO');
    expect(result.failures.join(' ')).toContain('ARTIFACT_RUN_ID_MISSING');
  });

  test('SEAL_NO_GO: package-validation ok=false (pacote não validado)', () => {
    buildConvergedRoot(dir, { pkgVal: { ok: false, runId: RUN_ID, sourceFingerprint: FP } });
    expect(evaluateSealState(dir).decision).toBe('SEAL_NO_GO');
  });

  test('SEAL_NO_GO: package-integrity NO_GO', () => {
    buildConvergedRoot(dir, { pkgInt: { decision: 'PACKAGE_INTEGRITY_NO_GO', pass: false, runId: RUN_ID } });
    expect(evaluateSealState(dir).decision).toBe('SEAL_NO_GO');
  });

  test('SEAL_NO_GO: proof/readiness/consistency não GO', () => {
    buildConvergedRoot(dir, { proof: { finalDecision: 'NO_GO:X' } });
    expect(evaluateSealState(dir).decision).toBe('SEAL_NO_GO');
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-seal2-'));
    buildConvergedRoot(dir2, { readiness: { finalDecision: 'NO_GO:Y' } });
    expect(evaluateSealState(dir2).decision).toBe('SEAL_NO_GO');
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  test('SEAL_NO_GO: scorecard ausente (fail-closed)', () => {
    // root vazio
    expect(evaluateSealState(dir).decision).toBe('SEAL_NO_GO');
  });
});
