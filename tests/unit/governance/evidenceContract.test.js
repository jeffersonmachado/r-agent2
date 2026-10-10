'use strict';

/**
 * CONTRATO ÚNICO DE EVIDÊNCIA — decisão pura.
 *
 * Achado P1 (auditoria 2026-10-10): não havia contrato único. Cada gate conferia
 * o que lembrava, campos exigidos pela missão (`environmentFingerprint`,
 * `configuration_hash`, `testPlanHash`, `blockingFindings`) não existiam em lugar
 * nenhum, e "evidência ausente" podia virar PASS. Aqui a decisão é uma função dos
 * dados, com `INCOMPLETE` separado de `FAIL`: o artefato existe, mas não carrega o
 * que prova o vínculo.
 */

const fs = require('fs');
const path = require('path');

const {
  REQUIRED_FIELDS,
  CODES,
  evaluateEvidenceArtifact,
  summarizeEvidenceContract,
} = require('../../../governance/lib/evidence-contract');

const RUN = { runId: 'rap-1', startedAt: '2026-10-10T10:00:00.000Z', sourceCommit: 'a'.repeat(40) };

function completeRecord(overrides = {}) {
  return {
    runId: RUN.runId,
    sourceCommit: RUN.sourceCommit,
    candidateCommit: 'b'.repeat(40),
    artifactHash: 'c'.repeat(64),
    environmentFingerprint: 'linux-node22',
    configurationHash: 'd'.repeat(64),
    policyVersion: '1.0.4',
    testPlanHash: 'e'.repeat(64),
    testResultHash: 'f'.repeat(64),
    evidenceManifestHash: '1'.repeat(64),
    sourceFingerprint: '2'.repeat(64),
    startedAt: '2026-10-10T10:00:10.000Z',
    finishedAt: '2026-10-10T10:05:00.000Z',
    producer: 'package-integrity-engine',
    result: 'PASS',
    blockingFindings: [],
    generatedAt: '2026-10-10T10:05:01.000Z',
    ...overrides,
  };
}

describe('evaluateEvidenceArtifact — o que uma evidência precisa carregar', () => {
  test('artefato completo é PASS', () => {
    const verdict = evaluateEvidenceArtifact({ record: completeRecord(), currentRun: RUN });
    expect(verdict).toMatchObject({ result: 'PASS', codes: [CODES.OK], missing: [] });
  });

  test('campo ausente é INCOMPLETE (nunca PASS por falta de dado)', () => {
    const verdict = evaluateEvidenceArtifact({ record: completeRecord({ candidateCommit: undefined }), currentRun: RUN });
    expect(verdict.result).toBe('INCOMPLETE');
    expect(verdict.codes).toContain(CODES.FIELD_MISSING);
    expect(verdict.missing).toContain('candidateCommit');
  });

  test('`blockingFindings: []` é VÁLIDO — lista vazia diz "nada bloqueia"; ausente não diz nada', () => {
    const vazio = evaluateEvidenceArtifact({ record: completeRecord({ blockingFindings: [] }), currentRun: RUN });
    expect(vazio.result).toBe('PASS');

    const ausente = evaluateEvidenceArtifact({ record: completeRecord({ blockingFindings: undefined }), currentRun: RUN });
    expect(ausente.missing).toContain('blockingFindings');
  });

  test('evidência de OUTRO run é recusada como FAIL (não é apenas incompleta)', () => {
    const verdict = evaluateEvidenceArtifact({
      record: completeRecord({ runId: 'rap-2' }),
      currentRun: RUN,
    });
    expect(verdict.codes).toContain(CODES.FOREIGN_RUN);
    expect(verdict.result).toBe('FAIL');
  });

  test('evidência produzida ANTES do run começar é FAIL (STALE)', () => {
    const verdict = evaluateEvidenceArtifact({
      record: completeRecord({ generatedAt: '2026-10-10T09:00:00.000Z' }),
      currentRun: RUN,
    });
    expect(verdict.codes).toContain(CODES.STALE);
    expect(verdict.result).toBe('FAIL');
  });

  test('artefato ausente/não-objeto é INCOMPLETE com código próprio', () => {
    for (const record of [null, undefined, 'texto', 42]) {
      const verdict = evaluateEvidenceArtifact({ record, currentRun: RUN });
      expect(verdict.result).toBe('INCOMPLETE');
      expect(verdict.codes).toContain(CODES.NOT_AN_OBJECT);
    }
  });

  test('aliases são aceitos (o vocabulário do repo não é uniforme)', () => {
    const verdict = evaluateEvidenceArtifact({
      record: {
        run_id: RUN.runId,
        source_commit: 'a'.repeat(40),
        candidate_commit: 'b'.repeat(40),
        sha256: 'c'.repeat(64),
        environment_fingerprint: 'x',
        configuration_hash: 'y',
        policy_version: '1.0.4',
        test_plan_hash: 'p',
        test_result_hash: 'r',
        evidence_manifest_hash: 'm',
        source_fingerprint: 's',
        started_at: '2026-10-10T10:00:10.000Z',
        completed_at: '2026-10-10T10:05:00.000Z',
        generated_by: 'engine-x',
        decision: 'GO',
        blocking: [],
        generated_at: '2026-10-10T10:05:01.000Z',
      },
      currentRun: RUN,
    });
    expect(verdict).toMatchObject({ result: 'PASS', missing: [] });
  });

  test('o contrato cobre TODOS os campos exigidos pela missão', () => {
    for (const field of [
      'runId', 'sourceCommit', 'candidateCommit', 'artifactHash', 'environmentFingerprint',
      'configurationHash', 'policyVersion', 'testPlanHash', 'testResultHash',
      'evidenceManifestHash', 'producer', 'result', 'blockingFindings',
    ]) {
      expect(REQUIRED_FIELDS).toContain(field);
    }
  });
});

describe('summarizeEvidenceContract — diagnóstico antes de virar bloqueio', () => {
  test('conta conformes, agrega campos ausentes e NÃO se declara gate', () => {
    const summary = summarizeEvidenceContract({
      records: [
        { name: 'ok.json', record: completeRecord() },
        { name: 'faltando.json', record: completeRecord({ environmentFingerprint: undefined, configurationHash: undefined }) },
        { name: 'estrangeiro.json', record: completeRecord({ runId: 'rap-9' }) },
      ],
      currentRun: RUN,
    });

    expect(summary).toMatchObject({ total: 3, passed: 1, violations: 2, enforced: false });
    expect(summary.missingByField.environmentFingerprint).toBe(1);
    expect(summary.missingByField.configurationHash).toBe(1);
    expect(summary.byCode[CODES.FOREIGN_RUN]).toBe(1);
    expect(summary.details.map((item) => item.name)).toContain('estrangeiro.json');
  });

  test('lista vazia não lança', () => {
    const summary = summarizeEvidenceContract({ records: null, currentRun: RUN });
    expect(summary).toMatchObject({ total: 0, passed: 0, violations: 0 });
  });
});

describe('não-vacuidade: o diagnóstico existe e é executável', () => {
  test('há script npm de diagnóstico e ele gera relatório próprio', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
    expect(pkg.scripts['report:evidence-contract']).toBe('node scripts/governance/report-evidence-contract.js');

    const script = fs.readFileSync(path.join(__dirname, '../../../scripts/governance/report-evidence-contract.js'), 'utf8');
    expect(script).toMatch(/reports\/evidence-contract-report\.json/);
    expect(script).toMatch(/summarizeEvidenceContract/);
  });
});
