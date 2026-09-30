#!/usr/bin/env node
'use strict';

/**
 * qa-evidence-same-run-eval.js — lógica PURA de avaliação do gate
 * QA_EVIDENCE_SAME_RUN, extraída de
 * `scripts/governance/validate-qa-evidence-same-run.js` para ser testável
 * (tests/unit/governance/qaEvidenceSameRun.test.js).
 *
 * Sem I/O: recebe o documento do artefato e a linha do run (já carregada pelo
 * caller via Sequelize) e devolve avaliação + violações tipadas.
 */

const CODES = Object.freeze({
  LINEAGE_MISSING: 'QA_EVIDENCE_LINEAGE_MISSING',
  RUN_UNKNOWN: 'QA_EVIDENCE_RUN_UNKNOWN',
  SAME_RUN_VIOLATION: 'QA_EVIDENCE_SAME_RUN_VIOLATION',
  SOURCE_MISMATCH: 'QA_EVIDENCE_SOURCE_MISMATCH',
  NO_TIMESTAMP: 'QA_EVIDENCE_NO_TIMESTAMP',
  INVALID_TIMESTAMP: 'QA_EVIDENCE_TIMESTAMP_INVALID',
});

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

function parseTime(value) {
  if (!isNonEmptyString(value)) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function evaluateArtifact(relPath, doc, run) {
  const violations = [];
  const mode = 'RUNTIME_EVIDENCE';
  const runId = doc?.runId || null;
  const fingerprint = doc?.sourceFingerprint || null;
  const generatedAt = parseTime(doc?.generatedAt);

  if (!isNonEmptyString(runId) || !isNonEmptyString(fingerprint)) {
    violations.push({ code: CODES.LINEAGE_MISSING, artifact: relPath, runId, fingerprint });
  }
  if (!isNonEmptyString(doc?.generatedAt)) {
    violations.push({ code: CODES.NO_TIMESTAMP, artifact: relPath });
  } else if (generatedAt === null) {
    violations.push({ code: CODES.INVALID_TIMESTAMP, artifact: relPath, generatedAt: doc.generatedAt });
  }
  if (!run) {
    if (isNonEmptyString(runId)) violations.push({ code: CODES.RUN_UNKNOWN, artifact: relPath, runId });
    return { artifact: relPath, mode, runId, fingerprint, generatedAt: doc?.generatedAt || null, sameRun: false, violations };
  }

  const startedAt = parseTime(run.started_at instanceof Date ? run.started_at.toISOString() : run.started_at);
  const completedAt = parseTime(run.completed_at instanceof Date ? run.completed_at.toISOString() : run.completed_at);

  // PROVA TEMPORAL: o artefato tem de ter sido produzido DEPOIS do início do
  // run que o reivindica. Antes disso é adotação retroativa.
  let sameRun = true;
  if (generatedAt !== null && startedAt !== null && generatedAt < startedAt) {
    sameRun = false;
    violations.push({
      code: CODES.SAME_RUN_VIOLATION,
      artifact: relPath,
      generatedAt: doc.generatedAt,
      runStartedAt: new Date(startedAt).toISOString(),
      deltaSeconds: Math.round((startedAt - generatedAt) / 1000),
      detail: 'artefato produzido ANTES do run que o reivindica: adoção retroativa de lineage',
    });
  }
  if (generatedAt !== null && completedAt !== null && generatedAt > completedAt) {
    // Produzido depois do fim do run: também não é prova DESTE run.
    sameRun = false;
    violations.push({
      code: CODES.SAME_RUN_VIOLATION,
      artifact: relPath,
      generatedAt: doc.generatedAt,
      runCompletedAt: new Date(completedAt).toISOString(),
      detail: 'artefato produzido DEPOIS do run que o reivindica',
    });
  }
  if (isNonEmptyString(fingerprint) && isNonEmptyString(run.source_fingerprint)
    && fingerprint !== run.source_fingerprint) {
    sameRun = false;
    violations.push({
      code: CODES.SOURCE_MISMATCH,
      artifact: relPath,
      artifactFingerprint: fingerprint,
      runFingerprint: run.source_fingerprint,
    });
  }

  // DEFEITO CORRIGIDO (2026-09-30): sem `runId`/`sourceFingerprint` o artefato NÃO é prova deste
  // run — antes o campo `sameRun` continuava `true` só porque o carimbo de tempo caía na janela,
  // contradizendo a violação `QA_EVIDENCE_LINEAGE_MISSING` registrada no mesmo retorno. Quem lê a
  // métrica (`sameRunOk`) enxergava evidência sem identidade como evidência same-run.
  if (!isNonEmptyString(runId) || !isNonEmptyString(fingerprint)) {
    sameRun = false;
  }

  return {
    artifact: relPath,
    mode,
    runId,
    fingerprint,
    generatedAt: doc?.generatedAt || null,
    runStartedAt: startedAt !== null ? new Date(startedAt).toISOString() : null,
    sameRun,
    violations,
  };
}

module.exports = {
  CODES,
  isNonEmptyString,
  parseTime,
  evaluateArtifact,
};
