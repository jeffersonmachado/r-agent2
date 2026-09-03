'use strict';

/**
 * Testes do verify-payload-governance — verifier fail-closed da governança
 * canônica DO PAYLOAD (fonte da verdade), incluindo a suíte adversarial
 * NO_GO→GO da missão de certification hardening.
 *
 * Cada teste constrói uma fixture completa de release (payload zip real com
 * governança embutida + envelope derivado + attestation Ed25519 com keypair
 * de teste) e adultera UM aspecto. O verifier deve reprovar com o gate certo.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildReleaseFixture, makeFixtureDir } = require('../../helpers/releaseEnvelopeFixture');

const VERIFIER = path.join(__dirname, '..', '..', '..', 'scripts', 'verify-payload-governance.js');

function runVerifier(fixture, extraArgs = []) {
  const result = spawnSync(process.execPath, [
    VERIFIER,
    '--payload', fixture.payloadPath,
    '--manifest', fixture.manifestPath,
    '--envelope-governance', fixture.envelopeGovDir,
    '--signatures', fixture.signaturesDir,
    '--verifier', fixture.verifierDir,
    ...extraArgs,
  ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  return {
    exitCode: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function gateStatus(output, gateId) {
  const line = output.split('\n').find((l) => l.includes(gateId));
  if (!line) return null;
  if (line.includes('FAIL')) return 'FAIL';
  if (line.includes('PASS')) return 'PASS';
  return null;
}

describe('verify-payload-governance — fixture íntegra (controle)', () => {
  test('release completo e coerente → PAYLOAD_GOVERNANCE_VERIFIED', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir);
    const result = runVerifier(fixture);
    expect(result.output).toContain('PAYLOAD_GOVERNANCE_VERIFIED');
    expect(result.exitCode).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('verify-payload-governance — suíte adversarial (toda adulteração reprova)', () => {
  const cases = [
    {
      name: 'payload final governance NO_GO',
      tamper: { payloadDecision: 'NO_GO:GOVERNANCE_BLOCKED' },
      gate: 'canonical_decision',
      reason: 'PAYLOAD_CANONICAL_NO_GO',
    },
    {
      name: 'envelope GO + payload NO_GO (a adulteração central da missão)',
      tamper: { payloadDecision: 'NO_GO:GOVERNANCE_BLOCKED', envelopeDecision: 'GO' },
      gate: 'governance_decision_match',
      reason: 'GOVERNANCE_DECISION_MISMATCH',
    },
    {
      name: 'envelope NO_GO + payload GO (cópia degradada também diverge)',
      tamper: { envelopeDecision: 'NO_GO:X' },
      gate: 'governance_decision_match',
      reason: 'GOVERNANCE_DECISION_MISMATCH',
    },
    {
      name: 'payload package-validation FAIL',
      tamper: { payloadPkgValOk: false },
      gate: 'payload_package_validation',
      reason: 'PAYLOAD_PACKAGE_VALIDATION_FAIL',
    },
    {
      name: 'payload package-validation sem lineage (ARTIFACT_RUN_ID_MISSING)',
      tamper: { payloadPkgValLineage: false },
      gate: 'payload_package_validation',
      reason: 'ARTIFACT_RUN_ID_MISSING',
    },
    {
      name: 'payload package-integrity NO_GO',
      tamper: { payloadIntegrityDecision: 'PACKAGE_INTEGRITY_NO_GO' },
      gate: 'payload_package_integrity',
      reason: 'PAYLOAD_PACKAGE_INTEGRITY_NO_GO',
    },
    {
      name: 'payload self-proving FAIL',
      tamper: { payloadSelfProofPass: false },
      gate: 'payload_self_proving',
      reason: 'PAYLOAD_SELF_PROVING_FAIL',
    },
    {
      name: 'scorecard 77/78 (RAP-052 < 10)',
      tamper: { scorecardBelow10: ['RAP-052'] },
      gate: 'payload_master_scorecard',
      reason: 'MASTER_SCORECARD_NOT_10_OF_10',
    },
    {
      name: 'RAP-054 < 10',
      tamper: { scorecardBelow10: ['RAP-054'] },
      gate: 'payload_master_scorecard',
      reason: 'MASTER_SCORECARD_NOT_10_OF_10',
    },
    {
      name: 'runId do payload diverge do manifest (cross-run artifact)',
      tamper: { payloadRunId: 'rap-governed-19990101000000000-foreign' },
      gate: 'run_id_consistency',
      reason: 'CROSS_RUN_ARTIFACT',
    },
    {
      name: 'sourceFingerprint do payload diverge do manifest',
      tamper: { payloadSourceFingerprint: 'f'.repeat(64) },
      gate: 'source_fingerprint_consistency',
      reason: 'SOURCE_FINGERPRINT_MISMATCH',
    },
    {
      name: 'signature ausente',
      tamper: { skipAttestation: true },
      gate: 'release_attestation_signature',
      reason: 'SIGNATURE_MISSING',
    },
    {
      name: 'signature inválida (assinada com outra chave)',
      tamper: { invalidAttestation: true },
      gate: 'release_attestation_signature',
      reason: 'SIGNATURE_INVALID',
    },
    {
      name: 'attestation com runId adulterado (re-assinado corretamente)',
      tamper: { attestationFieldOverrides: { runId: 'rap-governed-19990101000000000-forged' } },
      gate: 'release_attestation_signature',
      reason: 'SIGNATURE_FIELD_MISMATCH',
    },
    {
      name: 'attestation com finalDecision adulterada',
      tamper: { attestationFieldOverrides: { finalDecision: 'NO_GO:FORGED' } },
      gate: 'release_attestation_signature',
      reason: 'SIGNATURE_FIELD_MISMATCH',
    },
    {
      name: 'canonical hash binding divergente (transport copy adulterada)',
      tamper: { wrongCanonicalHash: true },
      gate: 'canonical_hash_binding',
      reason: 'CANONICAL_HASH_MISMATCH',
    },
    {
      name: 'canonical hash binding ausente',
      tamper: { skipCanonicalHashBinding: true },
      gate: 'canonical_hash_binding',
      reason: 'CANONICAL_HASH_MISSING',
    },
    {
      name: 'envelope package-validation FINAL FAIL',
      tamper: { envelopePkgValOk: false },
      gate: 'envelope_package_validation_final',
      reason: 'PACKAGE_VALIDATION_FAIL',
    },
    {
      name: 'envelope package-validation não bindado ao payload entregue',
      tamper: { envelopePkgValShaWrong: true },
      gate: 'envelope_package_validation_final',
      reason: 'PACKAGE_HASH_MISMATCH',
    },
    {
      name: 'envelope package-integrity NO_GO',
      tamper: { envelopeIntegrityPass: false },
      gate: 'envelope_package_integrity',
      reason: 'PACKAGE_INTEGRITY_NO_GO',
    },
    {
      name: 'envelope self-proving FAIL',
      tamper: { envelopeSelfProofPass: false },
      gate: 'envelope_self_proving',
      reason: 'SELF_PROVING_FAIL',
    },
    {
      name: 'payload readiness não é AUTONOMOUS_READY_GO',
      tamper: { payloadReadinessDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE' },
      gate: 'payload_readiness',
      reason: 'PAYLOAD_READINESS_NOT_GO',
    },
    {
      name: 'payload sem governança embutida',
      tamper: { omitPayloadGovernance: true },
      gate: 'canonical_governance_presence',
      reason: 'MISSING_CANONICAL_GOVERNANCE',
    },
    {
      name: 'manifest sha256 diverge do payload (pacote adulterado)',
      tamper: { manifestOverrides: { sha256: '0'.repeat(64), packageFingerprint: '0'.repeat(64) } },
      gate: 'payload_hash_binding',
      reason: 'PACKAGE_HASH_MISMATCH',
    },
    {
      name: 'manifest sem cleanWorktree=true (release sobre worktree sujo)',
      tamper: { cleanWorktree: false },
      gate: 'manifest_provenance',
      reason: 'DIRTY_WORKTREE',
    },
    {
      name: 'manifest com gitCommit malformado',
      tamper: { manifestOverrides: { git_commit: 'abc123' } },
      gate: 'manifest_provenance',
      reason: 'SOURCE_COMMIT_MISMATCH',
    },
  ];

  for (const testCase of cases) {
    test(`FAIL: ${testCase.name}`, () => {
      const dir = makeFixtureDir();
      const fixture = buildReleaseFixture(dir, testCase.tamper);
      const result = runVerifier(fixture);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('PAYLOAD_GOVERNANCE_NO_GO');
      expect(gateStatus(result.output, testCase.gate)).toBe('FAIL');
      expect(result.output).toContain(testCase.reason);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }
});

// ─── Fase DELIVERED: candidato DEFERRED verdadeiro ───────────────────────────
// Um candidato (below10 ⊆ {RAP-055,RAP-056}) carrega a decisão DEFERRED de
// ponta a ponta: o modo estrito o REJEITA (não é release) e o modo --candidate
// o aceita. Envelope GO sobre payload DEFERRED é reprovado em ambos.
const DEFERRED = 'PASS_WITH_DEFERRED_PACKAGE_GATE';

describe('verify-payload-governance --candidate — fase DELIVERED', () => {
  test('candidato íntegro: estrito REJEITA, candidato ACEITA', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, {
      payloadDecision: DEFERRED,
      scorecardBelow10: ['RAP-055', 'RAP-056'],
    });
    const strict = runVerifier(fixture);
    expect(strict.exitCode).toBe(1);
    expect(strict.output).toContain('PAYLOAD_CANONICAL_NO_GO');

    const candidate = runVerifier(fixture, ['--candidate']);
    expect(candidate.exitCode).toBe(0);
    expect(candidate.output).toContain('DELIVERED_PHASE_CANDIDATE_VERIFIED');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const candidateCases = [
    {
      name: 'envelope GO + payload DEFERRED (promoção proibida)',
      tamper: { payloadDecision: DEFERRED, envelopeDecision: 'GO', scorecardBelow10: ['RAP-055', 'RAP-056'] },
      gate: 'governance_decision_match',
      reason: 'GOVERNANCE_DECISION_MISMATCH',
    },
    {
      name: 'candidato com package-integrity NO_GO',
      tamper: { payloadDecision: DEFERRED, payloadIntegrityDecision: 'PACKAGE_INTEGRITY_NO_GO', scorecardBelow10: ['RAP-055', 'RAP-056'] },
      gate: 'payload_package_integrity',
      reason: 'PAYLOAD_PACKAGE_INTEGRITY_NO_GO',
    },
    {
      name: 'candidato com below10 fora de {RAP-055,RAP-056}',
      tamper: { payloadDecision: DEFERRED, scorecardBelow10: ['RAP-052'] },
      gate: 'payload_master_scorecard',
      reason: 'CANDIDATE_SCORECARD_INVALID',
    },
    {
      name: 'candidato com proof NO_GO',
      tamper: { payloadDecision: DEFERRED, payloadProofDecision: 'NO_GO:X', scorecardBelow10: ['RAP-055', 'RAP-056'] },
      gate: 'payload_proof',
      reason: 'PAYLOAD_PROOF_NO_GO',
    },
    {
      name: 'candidato com tamper NO_GO',
      tamper: { payloadDecision: DEFERRED, payloadTamperDecision: 'TAMPER_NO_GO', scorecardBelow10: ['RAP-055', 'RAP-056'] },
      gate: 'payload_tamper',
      reason: 'PAYLOAD_TAMPER_NO_GO',
    },
    {
      name: 'candidato com decisão arbitrária (não DEFERRED canônica)',
      tamper: { payloadDecision: 'NO_GO:QUALQUER', scorecardBelow10: ['RAP-055', 'RAP-056'] },
      gate: 'canonical_decision',
      reason: 'CANDIDATE_DECISION_INVALID',
    },
  ];

  for (const testCase of candidateCases) {
    test(`FAIL: ${testCase.name}`, () => {
      const dir = makeFixtureDir();
      const fixture = buildReleaseFixture(dir, testCase.tamper);
      const result = runVerifier(fixture, ['--candidate']);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('DELIVERED_PHASE_CANDIDATE_NO_GO');
      expect(gateStatus(result.output, testCase.gate)).toBe('FAIL');
      expect(result.output).toContain(testCase.reason);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }
});
