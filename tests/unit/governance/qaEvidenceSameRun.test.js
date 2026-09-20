'use strict';

/**
 * Testes do gate QA_EVIDENCE_SAME_RUN (validate-qa-evidence-same-run.js).
 *
 * Contexto forense (2026-09-19): `qa-mesh/go-no-go-report.json` gerado às
 * 10:46 foi estampado retroativamente com o runId de um run criado às 20:18 —
 * adoção retroativa de lineage aceita como prova. A lógica de avaliação foi
 * extraída para `scripts/governance/lib/qa-evidence-same-run-eval.js` (função
 * pura, sem I/O) exatamente para poder ser travada por estes testes:
 *   (a) generatedAt < run.started_at  => QA_EVIDENCE_SAME_RUN_VIOLATION
 *   (b) janela ok + fingerprint igual + runId conhecido => sameRun true
 *   (c) fingerprint divergente        => QA_EVIDENCE_SOURCE_MISMATCH
 *   (d) runId desconhecido            => QA_EVIDENCE_RUN_UNKNOWN
 *   (e) lineage ausente               => QA_EVIDENCE_LINEAGE_MISSING
 */

const {
  CODES,
  evaluateArtifact,
} = require('../../../scripts/governance/lib/qa-evidence-same-run-eval');

const RUN_ID = 'rap-governed-20260918201837632-be6d7695';
const FINGERPRINT = 'a'.repeat(16);
const ARTIFACT = 'qa-mesh/go-no-go-report.json';

const RUN = {
  run_id: RUN_ID,
  source_fingerprint: FINGERPRINT,
  started_at: '2026-09-18T20:18:37.707Z',
  completed_at: '2026-09-18T23:59:00.000Z',
};

function codesOf(result) {
  return (result.violations || []).map((v) => v.code);
}

describe('qa-evidence-same-run — evaluateArtifact', () => {
  it('(a) generatedAt ANTES de run.started_at => QA_EVIDENCE_SAME_RUN_VIOLATION', () => {
    const result = evaluateArtifact(ARTIFACT, {
      runId: RUN_ID,
      sourceFingerprint: FINGERPRINT,
      generatedAt: '2026-09-18T10:46:59.739Z', // ~9h32 antes do run (caso real)
    }, RUN);

    expect(result.sameRun).toBe(false);
    expect(codesOf(result)).toContain(CODES.SAME_RUN_VIOLATION);
    const violation = result.violations.find((v) => v.code === CODES.SAME_RUN_VIOLATION);
    expect(violation.deltaSeconds).toBeGreaterThan(0);
  });

  it('(a2) generatedAt DEPOIS de run.completed_at => QA_EVIDENCE_SAME_RUN_VIOLATION', () => {
    const result = evaluateArtifact(ARTIFACT, {
      runId: RUN_ID,
      sourceFingerprint: FINGERPRINT,
      generatedAt: '2026-09-19T01:00:00.000Z',
    }, RUN);

    expect(result.sameRun).toBe(false);
    expect(codesOf(result)).toContain(CODES.SAME_RUN_VIOLATION);
  });

  it('(b) generatedAt dentro da janela + fingerprint igual + runId conhecido => sameRun true sem violações', () => {
    const result = evaluateArtifact(ARTIFACT, {
      runId: RUN_ID,
      sourceFingerprint: FINGERPRINT,
      generatedAt: '2026-09-18T21:30:00.000Z',
    }, RUN);

    expect(result.sameRun).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('(b2) aceita started_at/completed_at como Date (linha Sequelize)', () => {
    const result = evaluateArtifact(ARTIFACT, {
      runId: RUN_ID,
      sourceFingerprint: FINGERPRINT,
      generatedAt: '2026-09-18T21:30:00.000Z',
    }, {
      ...RUN,
      started_at: new Date(RUN.started_at),
      completed_at: new Date(RUN.completed_at),
    });

    expect(result.sameRun).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('(c) fingerprint divergente do run => QA_EVIDENCE_SOURCE_MISMATCH', () => {
    const result = evaluateArtifact(ARTIFACT, {
      runId: RUN_ID,
      sourceFingerprint: 'f'.repeat(16),
      generatedAt: '2026-09-18T21:30:00.000Z',
    }, RUN);

    expect(codesOf(result)).toContain(CODES.SOURCE_MISMATCH);
    const violation = result.violations.find((v) => v.code === CODES.SOURCE_MISMATCH);
    expect(violation.artifactFingerprint).toBe('f'.repeat(16));
    expect(violation.runFingerprint).toBe(FINGERPRINT);
  });

  it('(d) runId desconhecido (run ausente no banco) => QA_EVIDENCE_RUN_UNKNOWN', () => {
    const result = evaluateArtifact(ARTIFACT, {
      runId: 'rap-governed-19990101000000000-deadbeef',
      sourceFingerprint: FINGERPRINT,
      generatedAt: '2026-09-18T21:30:00.000Z',
    }, null);

    expect(result.sameRun).toBe(false);
    expect(codesOf(result)).toContain(CODES.RUN_UNKNOWN);
  });

  it('(e) lineage ausente (sem runId/sourceFingerprint) => QA_EVIDENCE_LINEAGE_MISSING', () => {
    const result = evaluateArtifact(ARTIFACT, {
      generatedAt: '2026-09-18T21:30:00.000Z',
    }, null);

    expect(result.sameRun).toBe(false);
    expect(codesOf(result)).toContain(CODES.LINEAGE_MISSING);
    // Sem runId não se acusa RUN_UNKNOWN: não há identidade a procurar.
    expect(codesOf(result)).not.toContain(CODES.RUN_UNKNOWN);
  });

  it('sem generatedAt => QA_EVIDENCE_NO_TIMESTAMP (não há prova temporal)', () => {
    const result = evaluateArtifact(ARTIFACT, {
      runId: RUN_ID,
      sourceFingerprint: FINGERPRINT,
    }, RUN);

    expect(codesOf(result)).toContain(CODES.NO_TIMESTAMP);
  });

  it('generatedAt inválido => QA_EVIDENCE_TIMESTAMP_INVALID', () => {
    const result = evaluateArtifact(ARTIFACT, {
      runId: RUN_ID,
      sourceFingerprint: FINGERPRINT,
      generatedAt: 'não-é-uma-data',
    }, RUN);

    expect(codesOf(result)).toContain(CODES.INVALID_TIMESTAMP);
  });
});
