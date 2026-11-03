'use strict';

/**
 * FASE6-NOVO-CANDIDATO-POR-MUDANCA-DE-FINGERPRINT.
 *
 * Regra do ciclo de release: o candidato é construído SOBRE um conteúdo (sourceFingerprint). Se o
 * conteúdo muda, o candidato anterior deixa de representar o que vai ser publicado — é preciso um
 * candidato NOVO. Reutilizar o antigo publica bytes de uma árvore que não existe mais.
 *
 * Esta suíte mede a regra em dois runIds/fingerprints, usando os verificadores canônicos
 * (`validateRunIsolation` + `verifyReleaseIdentity`), em vez de narrar o procedimento.
 */

const crypto = require('crypto');

const {
  CANDIDATE_ARTIFACT_TYPE,
  DELIVERED_ARTIFACT_TYPE,
  IDENTITY_CODES,
  validateRunIsolation,
  verifyReleaseIdentity,
} = require('../../../governance/release-artifact-identity');

const sha = (seed) => crypto.createHash('sha256').update(String(seed)).digest('hex');
const COMMIT = 'a'.repeat(40);

const RUN_A = 'rap-governed-20261101080000000-aaaa0001';
const RUN_B = 'rap-governed-20261101090000000-bbbb0002';

const candidato = (runId, fingerprint) => ({
  artifactType: CANDIDATE_ARTIFACT_TYPE,
  releasePhase: 'CANDIDATE_BUILT',
  release: 'r-agent2-20261101-080000',
  candidateHash: sha('candidate-bytes'),
  sourceCommit: COMMIT,
  sourceFingerprint: fingerprint,
  governanceRunId: runId,
  createdAt: '2026-11-01T08:00:00.000Z',
  canonicalPath: 'dist/candidate/r-agent2-20261101-080000.candidate.zip',
});

const entregue = (runId, fingerprint) => ({
  artifactType: DELIVERED_ARTIFACT_TYPE,
  releasePhase: 'DELIVERED',
  release: 'r-agent2-20261101-080000',
  sourceCommit: COMMIT,
  sourceFingerprint: fingerprint,
  candidateHash: sha('candidate-bytes'),
  parentCandidateHash: sha('candidate-bytes'),
  finalPayloadHash: sha('payload-bytes'),
  governanceRunId: runId,
  createdAt: '2026-11-01T08:05:00.000Z',
});

const FP_ANTIGO = sha('arvore-v1');
const FP_NOVO = sha('arvore-v2');

describe('Fase 6 — mudou o conteúdo, o candidato anterior não serve', () => {
  test('candidato do run/fingerprint ANTIGO não passa no run NOVO', () => {
    const r = validateRunIsolation({
      candidate: candidato(RUN_A, FP_ANTIGO),
      delivered: entregue(RUN_A, FP_ANTIGO),
      currentRun: { runId: RUN_B, sourceFingerprint: FP_NOVO },
    });
    expect(r.valid).toBe(false);
    // O runId estrangeiro é o primeiro sintoma; o fingerprint divergente é o segundo.
    expect([IDENTITY_CODES.FOREIGN_RUN, IDENTITY_CODES.SOURCE_MISMATCH]).toContain(r.code);
  });

  test('MESMO run, conteúdo diferente ⇒ SOURCE_MISMATCH (a árvore mudou debaixo do candidato)', () => {
    const r = validateRunIsolation({
      candidate: candidato(RUN_B, FP_ANTIGO),
      delivered: entregue(RUN_B, FP_ANTIGO),
      currentRun: { runId: RUN_B, sourceFingerprint: FP_NOVO },
    });
    expect(r.valid).toBe(false);
    expect(r.code).toBe(IDENTITY_CODES.SOURCE_MISMATCH);
  });

  test('candidato NOVO (run e fingerprint correntes) passa — não-vacuidade', () => {
    const r = validateRunIsolation({
      candidate: candidato(RUN_B, FP_NOVO),
      delivered: entregue(RUN_B, FP_NOVO),
      currentRun: { runId: RUN_B, sourceFingerprint: FP_NOVO },
    });
    expect(r.valid).toBe(true);
  });
});

describe('Fase 6 — a verificação completa reprova antes de publicar', () => {
  const base = (over = {}) => ({
    candidateActualHash: sha('candidate-bytes'),
    deliveredActualHash: sha('payload-bytes'),
    ...over,
  });

  test('cadeia coerente no MESMO fingerprint ⇒ PASS', () => {
    const r = verifyReleaseIdentity(base({
      candidate: candidato(RUN_B, FP_NOVO),
      delivered: entregue(RUN_B, FP_NOVO),
      currentRun: { runId: RUN_B, sourceFingerprint: FP_NOVO },
    }));
    expect(r.valid).toBe(true);
  });

  test('candidato do run anterior reprova a verificação completa (não publica)', () => {
    const r = verifyReleaseIdentity(base({
      candidate: candidato(RUN_A, FP_ANTIGO),
      delivered: entregue(RUN_A, FP_ANTIGO),
      currentRun: { runId: RUN_B, sourceFingerprint: FP_NOVO },
    }));
    expect(r.valid).toBe(false);
    expect(r.code).toBe(IDENTITY_CODES.FOREIGN_RUN);
  });

  test('entregue reaproveitado com fingerprint antigo reprova mesmo com run corrente', () => {
    const r = verifyReleaseIdentity(base({
      candidate: candidato(RUN_B, FP_NOVO),
      delivered: entregue(RUN_B, FP_ANTIGO),
      currentRun: { runId: RUN_B, sourceFingerprint: FP_NOVO },
    }));
    expect(r.valid).toBe(false);
    expect([IDENTITY_CODES.SOURCE_MISMATCH, IDENTITY_CODES.SOURCE_MISMATCH]).toContain(r.code);
  });

  test('sem run corrente NÃO há como provar que o candidato é o do conteúdo atual', () => {
    const r = verifyReleaseIdentity(base({
      candidate: candidato(RUN_B, FP_NOVO),
      delivered: entregue(RUN_B, FP_NOVO),
      currentRun: null,
    }));
    expect(r.valid).toBe(false);
    expect(r.code).toBe(IDENTITY_CODES.IDENTITY_MISSING);
  });
});
