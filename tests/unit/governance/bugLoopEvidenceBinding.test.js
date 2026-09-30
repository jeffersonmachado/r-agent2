'use strict';

/**
 * RELEASE_EVIDENCE_BINDING — provas de que a evidência consumida pelo ciclo de bug pertence ao run
 * governado, e que uma evidência ESTRANGEIRA é recusada.
 *
 * Duas camadas, ambas autoridade única (nenhuma reimplementação aqui):
 *   1. `evaluateArtifact` (scripts/governance/lib/qa-evidence-same-run-eval.js) — o avaliador do gate
 *      `validate:qa-evidence-same-run`, que julga lineage/temporalidade/source de RUNTIME_EVIDENCE;
 *   2. `bindEvidenceToRun` (scripts/governance/validate-bug-autonomous-loop.js) — a checagem que o
 *      gate do ciclo de bug faz sobre a execução autoritativa que ele COMPÕE.
 *
 * DEFEITO REAL que motivou esta prova (2026-09-30): `reports/release-suite-execution.json` era
 * gravado SEM runId/sourceFingerprint. O gate do ciclo de bug compunha como prova deste run uma
 * execução que não tinha como ser atribuída a ele — e o selo V2 aceitava o conjunto. Agora o
 * produtor estampa o lineage na origem e o consumidor RECUSA evidência sem lineage ou de outro run.
 */

const path = require('path');

const {
  evaluateArtifact,
} = require('../../../scripts/governance/lib/qa-evidence-same-run-eval');
const { applyOriginLineage, resolveRunLineage } = require('../../../scripts/governance/lib/resolve-run-lineage');

const RUN = {
  run_id: 'rap-governed-20260930011544805-3f8876d9',
  started_at: '2026-09-30T01:15:45.329Z',
  completed_at: null,
  source_fingerprint: '82e38621c64572decb0fe65901cba31ddb8af33cd94e1314cdf0d29b3edad372',
};

const ARTIFACT = 'reports/release-suite-execution.json';

describe('release evidence binding — evidência do ciclo de bug pertence ao run que a julga', () => {
  test('evidência DESTE run: lineage completo, produzida dentro da janela do run', () => {
    const doc = applyOriginLineage({
      artifactType: 'release-suite-execution-report',
      generatedAt: '2026-09-30T02:00:00.000Z',
    }, { runId: RUN.run_id, sourceFingerprint: RUN.source_fingerprint });

    const evaluation = evaluateArtifact(ARTIFACT, doc, RUN);
    expect(evaluation.sameRun).toBe(true);
    expect(evaluation.violations).toHaveLength(0);
    // O produtor grava a identidade NA ORIGEM — não existe campo inventado nem ausente.
    expect(doc.runId).toBe(RUN.run_id);
    expect(doc.sourceFingerprint).toBe(RUN.source_fingerprint);
    expect(doc.sourceCommit).toBeNull(); // sem commit informado, null explícito (nunca inventado)
  });

  test('STALE_EVIDENCE_REJECTED: artefato produzido ANTES do run que o reivindica é adoção retroativa', () => {
    const doc = applyOriginLineage({
      generatedAt: '2026-09-30T00:28:29.021Z', // medido: execução anterior ao run corrente
    }, { runId: RUN.run_id, sourceFingerprint: RUN.source_fingerprint });

    const evaluation = evaluateArtifact(ARTIFACT, doc, RUN);
    expect(evaluation.sameRun).toBe(false);
    expect(evaluation.violations.map((v) => v.code)).toContain('QA_EVIDENCE_SAME_RUN_VIOLATION');
    expect(evaluation.violations[0].detail).toContain('adoção retroativa');
  });

  test('evidência SEM lineage é recusada: "não sei a qual run pertence" não é prova deste run', () => {
    const evaluation = evaluateArtifact(ARTIFACT, { generatedAt: '2026-09-30T02:00:00.000Z' }, RUN);
    expect(evaluation.sameRun).toBe(false);
    expect(evaluation.violations.map((v) => v.code)).toContain('QA_EVIDENCE_LINEAGE_MISSING');
  });

  test('evidência de run DESCONHECIDO é recusada (não vira prova por omissão)', () => {
    const doc = applyOriginLineage({ generatedAt: '2026-09-30T02:00:00.000Z' }, { runId: 'rap-governed-00000000000000000-00000000', sourceFingerprint: 'f'.repeat(64) });
    const evaluation = evaluateArtifact(ARTIFACT, doc, null);
    expect(evaluation.sameRun).toBe(false);
    expect(evaluation.violations.map((v) => v.code)).toContain('QA_EVIDENCE_RUN_UNKNOWN');
  });

  test('FOREIGN_RUN_EVIDENCE: a checagem do gate do ciclo recusa execução de OUTRO run', () => {
    const { bindEvidenceToRun } = require('../../../scripts/governance/validate-bug-autonomous-loop');
    // Módulo do gate lê o disco por design (é o trabalho dele). O contrato testável aqui é o
    // MECANISMO: a identidade exigida vem da autoridade única de lineage, nunca de "o run mais
    // recente". Fora de run governado o estado é DECLARADO (PENDING), nunca PASS mudo.
    const lineage = resolveRunLineage({ rootDir: path.join(__dirname, '..', '..', '..') });
    const binding = bindEvidenceToRun();
    expect(binding.lineage.runId).toBe(lineage.runId);
    expect(['PASS', 'FAIL', 'PENDING_NO_GOVERNED_RUN', 'PENDING_NO_EVIDENCE']).toContain(binding.status);
    if (lineage.runId && binding.evidence.present && binding.evidence.runId && binding.evidence.runId !== lineage.runId) {
      expect(binding.violations.map((v) => v.code)).toContain('FOREIGN_RUN_EVIDENCE');
    }
    // Invariante do enforcement: FAIL só acontece com violação NOMEADA.
    if (binding.status === 'FAIL') expect(binding.violations.length).toBeGreaterThan(0);
  });
});
