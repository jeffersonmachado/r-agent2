'use strict';

/**
 * Testes adversariais do gate offline `payload_outbound_reliability`
 * (verify-payload-governance.js — gate 12e).
 *
 * A prova de confiabilidade do pipeline outbound
 * (governance/outbound-reliability-report.json) é packageRequired dentro do
 * payload: o verifier offline valida existência, status PASS, invariantes
 * semânticos, lineage (runId/sourceFingerprint == manifest), entrada no
 * evidence-manifest (packageRequired + proofStatus=valid) e binding de hash
 * com o arquivo físico. Qualquer divergência → FAIL (nunca PASS por ausência).
 *
 * Casos A–K da missão de seal + cobertura fail-closed adicional (manifest
 * entry ausente, packageRequired=false, proofStatus inválido, sem lineage).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildReleaseFixture, makeFixtureDir } = require('../../helpers/releaseEnvelopeFixture');

const VERIFIER = path.join(__dirname, '..', '..', '..', 'scripts', 'verify-payload-governance.js');

function runVerifier(fixture) {
  const result = spawnSync(process.execPath, [
    VERIFIER,
    '--payload', fixture.payloadPath,
    '--manifest', fixture.manifestPath,
    '--envelope-governance', fixture.envelopeGovDir,
    '--signatures', fixture.signaturesDir,
    '--verifier', fixture.verifierDir,
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

function expectGateFail(tamper, code) {
  const dir = makeFixtureDir();
  const fixture = buildReleaseFixture(dir, tamper);
  const result = runVerifier(fixture);
  expect(result.exitCode).toBe(1);
  expect(gateStatus(result.output, 'payload_outbound_reliability')).toBe('FAIL');
  if (code) expect(result.output).toContain(code);
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('payload_outbound_reliability — gate offline fail-closed (24 gates)', () => {
  test('Caso K (positivo): prova íntegra → PASS, 24/24 gates, exit 0', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, {});
    const result = runVerifier(fixture);
    expect(result.output).toContain('PAYLOAD_GOVERNANCE_VERIFIED');
    expect(result.exitCode).toBe(0);
    expect(gateStatus(result.output, 'payload_outbound_reliability')).toBe('PASS');
    const gateLines = result.output.split('\n').filter((l) => /^\s+[✓✗] /.test(l));
    expect(gateLines).toHaveLength(24);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('Caso A: report removido do payload → FAIL (OUTBOUND_RELIABILITY_EVIDENCE_MISSING)', () => {
    expectGateFail({ omitOutboundReliability: true }, 'OUTBOUND_RELIABILITY_EVIDENCE_MISSING');
  });

  test('Caso B: status=FAIL → FAIL (OUTBOUND_RELIABILITY_NO_GO)', () => {
    expectGateFail({ obrStatus: 'FAIL' }, 'OUTBOUND_RELIABILITY_NO_GO');
  });

  test('Caso C: transactionalOutbox=false → FAIL', () => {
    expectGateFail({ obrFlags: { transactionalOutbox: false } }, 'transactionalOutbox != true');
  });

  test('Caso D: partialStatePossible=true → FAIL', () => {
    expectGateFail({ obrFlags: { partialStatePossible: true } }, 'partialStatePossible != false');
  });

  test('Caso E: blindRetryAfterAmbiguousDelivery=true → FAIL', () => {
    expectGateFail({ obrFlags: { blindRetryAfterAmbiguousDelivery: true } }, 'blindRetryAfterAmbiguousDelivery != false');
  });

  test('Caso F: providerCapabilityAwareRecovery=false → FAIL', () => {
    expectGateFail({ obrFlags: { providerCapabilityAwareRecovery: false } }, 'providerCapabilityAwareRecovery != true');
  });

  test('Caso G: logicalDuplicateOperations=1 → FAIL', () => {
    expectGateFail({ obrFlags: { logicalDuplicateOperations: 1 } }, 'logicalDuplicateOperations=1');
  });

  test('Caso H: runId divergente do manifest → FAIL (CROSS_RUN_ARTIFACT)', () => {
    expectGateFail({ obrRunId: 'rap-governed-19990101000000000-outro000' }, 'CROSS_RUN_ARTIFACT');
  });

  test('Caso I: sourceFingerprint divergente do manifest → FAIL (SOURCE_FINGERPRINT_MISMATCH)', () => {
    expectGateFail({ obrSourceFingerprint: 'f'.repeat(64) }, 'SOURCE_FINGERPRINT_MISMATCH');
  });

  test('Caso J: conteúdo modificado sem atualizar o hash no manifest → FAIL (EVIDENCE_HASH_MISMATCH)', () => {
    expectGateFail({ obrHashMismatch: true }, 'OUTBOUND_RELIABILITY_EVIDENCE_HASH_MISMATCH');
  });

  test('fail-closed: entrada ausente no evidence-manifest → FAIL (NOT_IN_MANIFEST)', () => {
    expectGateFail({ obrManifestEntryMissing: true }, 'OUTBOUND_RELIABILITY_NOT_IN_MANIFEST');
  });

  test('fail-closed: packageRequired=false no evidence-manifest → FAIL (NOT_PACKAGE_REQUIRED)', () => {
    expectGateFail({ obrNotPackageRequired: true }, 'OUTBOUND_RELIABILITY_NOT_PACKAGE_REQUIRED');
  });

  test('fail-closed: proofStatus=invalid no evidence-manifest → FAIL (PROOF_INVALID)', () => {
    expectGateFail({ obrProofStatusInvalid: true }, 'OUTBOUND_RELIABILITY_PROOF_INVALID');
  });

  test('fail-closed: report sem lineage (runId/sourceFingerprint) → FAIL (ARTIFACT_RUN_ID_MISSING)', () => {
    expectGateFail({ obrNoLineage: true }, 'ARTIFACT_RUN_ID_MISSING');
  });
});
