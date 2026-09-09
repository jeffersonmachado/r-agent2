'use strict';

/**
 * Testes do hardening de higiene de release:
 *   - verify-result.json stale NÃO pode ser empacotado (Casos A/B);
 *   - evidência de experience-segregation é packageRequired dentro do payload
 *     (Casos C–H);
 *   - relatório de consistência DEFERRED nunca se apresenta como FINAL
 *     (Caso I);
 *   - envelope limpo + evidência íntegra → PASS (testes positivos);
 *   - allowlist do envelope (release-payload-blocklist.sh) rejeita
 *     verify-result.json mesmo se ele for plantado antes do packaging.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { buildReleaseFixture, makeFixtureDir } = require('../../helpers/releaseEnvelopeFixture');

const VERIFIER = path.join(__dirname, '..', '..', '..', 'scripts', 'verify-payload-governance.js');
const BLOCKLIST = path.join(__dirname, '..', '..', '..', 'scripts', 'release-payload-blocklist.sh');

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

describe('release hygiene — testes positivos (envelope limpo + evidência íntegra)', () => {
  test('release limpo com envelope físico → PAYLOAD_GOVERNANCE_VERIFIED (gates novos PASS)', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, { buildEnvelope: true });
    const result = runVerifier(fixture);
    expect(result.output).toContain('PAYLOAD_GOVERNANCE_VERIFIED');
    expect(result.exitCode).toBe(0);
    expect(gateStatus(result.output, 'release_hygiene')).toBe('PASS');
    expect(gateStatus(result.output, 'payload_experience_segregation')).toBe('PASS');
    expect(gateStatus(result.output, 'payload_experience_api_segregation')).toBe('PASS');
    expect(gateStatus(result.output, 'payload_outbound_reliability')).toBe('PASS');
    expect(gateStatus(result.output, 'consistency_phase_semantics')).toBe('PASS');
    // 24 gates mandatory: 1–20 + 12b (experience_segregation) +
    // 12c (final_status_projection) + 12d (experience_api_segregation) +
    // 12e (outbound_reliability).
    const gateLines = result.output.split('\n').filter((l) => /^\s+[✓✗] /.test(l));
    expect(gateLines).toHaveLength(24);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('candidato DEFERRED: consistência PRE_PACKAGE + evidência íntegra → candidato ACEITO', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, {
      payloadDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE',
      scorecardBelow10: ['RAP-055', 'RAP-056'],
      buildEnvelope: true,
    });
    const result = runVerifier(fixture, ['--candidate']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('DELIVERED_PHASE_CANDIDATE_VERIFIED');
    expect(gateStatus(result.output, 'release_hygiene')).toBe('PASS');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('release hygiene — Casos A/B: verify-result stale nunca entra no envelope', () => {
  const staleVerifyResult = {
    generatedAt: '2026-09-03T22:27:32.000Z',
    verifier: 'verify-enterprise-governance-v2.sh',
    status: 'PASS',
    pass: true,
    payload: 'r-agent2-20260903-222732.payload.zip',
    payloadSha256: 'f'.repeat(64),
  };

  test('Caso A: envelope com verify-result.json de release anterior → STALE_VERIFIER_RESULT', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, {
      envelopeExtraFiles: { 'r-agent2/dist/verifier/verify-result.json': staleVerifyResult },
    });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, 'release_hygiene')).toBe('FAIL');
    expect(result.output).toContain('STALE_VERIFIER_RESULT');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('Caso B: verify-result.json com hash antigo → STALE_VERIFIER_RESULT (presença já basta)', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, {
      envelopeExtraFiles: {
        'r-agent2/dist/verifier/verify-result.json': { ...staleVerifyResult, payloadSha256: 'e'.repeat(64) },
      },
    });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, 'release_hygiene')).toBe('FAIL');
    expect(result.output).toContain('STALE_VERIFIER_RESULT');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('Caso A2: artefato de outro release no envelope → FOREIGN_RELEASE_ARTIFACT', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, {
      envelopeExtraFiles: { 'r-agent2/dist/release/r-agent2-19990101-000000.payload.zip': 'foreign' },
    });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, 'release_hygiene')).toBe('FAIL');
    expect(result.output).toContain('FOREIGN_RELEASE_ARTIFACT');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('Caso A3: allowlist do blocklist script rejeita verify-result.json plantado', () => {
    // Simula o packaging com um verify-result.json plantado: a função
    // release_envelope_validate_zip deve REPROVAR o envelope.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-envelope-blocklist-'));
    const tree = path.join(dir, 'tree');
    fs.mkdirSync(path.join(tree, 'r-agent2', 'dist', 'verifier'), { recursive: true });
    fs.mkdirSync(path.join(tree, 'r-agent2', 'dist', 'release'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'r-agent2', 'dist', 'verifier', 'verify-enterprise-governance.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(tree, 'r-agent2', 'dist', 'verifier', 'verify-result.json'), JSON.stringify(staleVerifyResult));
    fs.writeFileSync(path.join(tree, 'r-agent2', 'dist', 'release', 'r-agent2-20260101-000000.payload.zip'), 'x');
    const zipPath = path.join(dir, 'envelope.zip');
    execFileSync('zip', ['-qr', zipPath, 'r-agent2/'], { cwd: tree });

    const result = spawnSync('bash', [
      '-c',
      `source "${BLOCKLIST}" && release_envelope_validate_zip "${zipPath}"`,
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('unexpected entries');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('experience segregation evidence — Casos C–H (evidência packageRequired no payload)', () => {
  const cases = [
    {
      name: 'Caso C: evidência ausente no payload',
      tamper: { omitExperienceSegregation: true },
      reason: 'EXPERIENCE_SEGREGATION_EVIDENCE_MISSING',
    },
    {
      name: 'Caso D: runId divergente do release',
      tamper: { expSegRunId: 'rap-governed-19990101000000000-foreign' },
      reason: 'CROSS_RUN_ARTIFACT',
    },
    {
      name: 'Caso E: sourceFingerprint divergente',
      tamper: { expSegSourceFingerprint: 'f'.repeat(64) },
      reason: 'SOURCE_FINGERPRINT_MISMATCH',
    },
    {
      name: 'Caso F: violationCount=1',
      tamper: { expSegViolationCount: 1 },
      reason: 'EXPERIENCE_SEGREGATION_NO_GO',
    },
    {
      name: 'Caso G: status=FAIL',
      tamper: { expSegStatus: 'FAIL' },
      reason: 'EXPERIENCE_SEGREGATION_NO_GO',
    },
    {
      name: 'Caso H: hash registrado diverge do físico (adulteração pós-empacotamento)',
      tamper: { expSegHashMismatch: true },
      reason: 'EXPERIENCE_SEGREGATION_EVIDENCE_HASH_MISMATCH',
    },
    {
      name: 'Caso C2: evidência sem lineage (runId/sourceFingerprint ausentes)',
      tamper: { expSegNoLineage: true },
      reason: 'ARTIFACT_RUN_ID_MISSING',
    },
    {
      name: 'Caso C3: evidence-manifest não marca a prova como packageRequired',
      tamper: { expSegNotPackageRequired: true },
      reason: 'EXPERIENCE_SEGREGATION_NOT_PACKAGE_REQUIRED',
    },
    {
      name: 'Caso C4: evidence-manifest do payload sem entrada experience_segregation',
      tamper: { expSegManifestEntryMissing: true },
      reason: 'EXPERIENCE_SEGREGATION_NOT_IN_MANIFEST',
    },
  ];

  for (const testCase of cases) {
    test(`FAIL: ${testCase.name}`, () => {
      const dir = makeFixtureDir();
      const fixture = buildReleaseFixture(dir, testCase.tamper);
      const result = runVerifier(fixture);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('PAYLOAD_GOVERNANCE_NO_GO');
      expect(gateStatus(result.output, 'payload_experience_segregation')).toBe('FAIL');
      expect(result.output).toContain(testCase.reason);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }
});

describe('experience API segregation evidence — gate payload_experience_api_segregation (23º gate)', () => {
  const cases = [
    {
      name: 'evidência ausente no payload',
      tamper: { omitExperienceApiSegregation: true },
      reason: 'EXPERIENCE_API_SEGREGATION_EVIDENCE_MISSING',
    },
    {
      name: 'status=FAIL',
      tamper: { expApiSegStatus: 'FAIL' },
      reason: 'EXPERIENCE_API_SEGREGATION_NO_GO',
    },
    {
      name: 'productionTechnicalLeaks=1 (vazamento técnico em superfície PRODUCTION)',
      tamper: { expApiSegLeaks: { productionTechnicalLeaks: 1 } },
      reason: 'EXPERIENCE_API_SEGREGATION_LEAKS',
    },
    {
      name: 'runId divergente do release',
      tamper: { expApiSegRunId: 'rap-governed-19990101000000000-foreign' },
      reason: 'CROSS_RUN_ARTIFACT',
    },
    {
      name: 'sourceFingerprint divergente',
      tamper: { expApiSegSourceFingerprint: 'f'.repeat(64) },
      reason: 'SOURCE_FINGERPRINT_MISMATCH',
    },
    {
      name: 'hash registrado diverge do físico (adulteração pós-empacotamento)',
      tamper: { expApiSegHashMismatch: true },
      reason: 'EXPERIENCE_API_SEGREGATION_EVIDENCE_HASH_MISMATCH',
    },
    {
      name: 'evidence-manifest do payload sem entrada experience_api_segregation',
      tamper: { expApiSegManifestEntryMissing: true },
      reason: 'EXPERIENCE_API_SEGREGATION_NOT_IN_MANIFEST',
    },
    {
      name: 'evidence-manifest não marca a prova como packageRequired',
      tamper: { expApiSegNotPackageRequired: true },
      reason: 'EXPERIENCE_API_SEGREGATION_NOT_PACKAGE_REQUIRED',
    },
    {
      name: 'evidência sem lineage (runId/sourceFingerprint ausentes)',
      tamper: { expApiSegNoLineage: true },
      reason: 'ARTIFACT_RUN_ID_MISSING',
    },
  ];

  for (const testCase of cases) {
    test(`FAIL: ${testCase.name}`, () => {
      const dir = makeFixtureDir();
      const fixture = buildReleaseFixture(dir, testCase.tamper);
      const result = runVerifier(fixture);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('PAYLOAD_GOVERNANCE_NO_GO');
      expect(gateStatus(result.output, 'payload_experience_api_segregation')).toBe('FAIL');
      expect(result.output).toContain(testCase.reason);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }
});

describe('remote provenance evidence — gate manifest_provenance (extensão offline, 24 gates com outbound_reliability)', () => {
  const cases = [
    {
      name: 'evidência ausente no payload',
      tamper: { omitRemoteProvenance: true },
      reason: 'REMOTE_PROVENANCE_EVIDENCE_MISSING',
    },
    {
      name: 'status=FAIL (gate remoto reprovou antes do SEAL_GO)',
      tamper: { remoteProvStatus: 'FAIL' },
      reason: 'REMOTE_PROVENANCE_MISMATCH',
    },
    {
      name: 'commit da evidência diverge do manifest',
      tamper: { remoteProvCommit: 'd'.repeat(40) },
      reason: 'REMOTE_PROVENANCE_MISMATCH',
    },
    {
      name: 'tree da evidência diverge do manifest',
      tamper: { remoteProvTree: 'e'.repeat(40) },
      reason: 'REMOTE_PROVENANCE_MISMATCH',
    },
    {
      name: 'commitExists=false (evidência adulterada para PASS sem verificação real)',
      tamper: { remoteProvCommitExists: false },
      reason: 'REMOTE_PROVENANCE_MISMATCH',
    },
    {
      name: 'treeMatches=false',
      tamper: { remoteProvTreeMatches: false },
      reason: 'REMOTE_PROVENANCE_MISMATCH',
    },
    {
      name: 'hash registrado diverge do físico (adulteração pós-empacotamento)',
      tamper: { remoteProvHashMismatch: true },
      reason: 'REMOTE_PROVENANCE_EVIDENCE_HASH_MISMATCH',
    },
    {
      name: 'evidence-manifest do payload sem entrada source_remote_provenance',
      tamper: { remoteProvManifestEntryMissing: true },
      reason: 'REMOTE_PROVENANCE_NOT_IN_MANIFEST',
    },
    {
      name: 'evidence-manifest não marca a prova como packageRequired',
      tamper: { remoteProvNotPackageRequired: true },
      reason: 'REMOTE_PROVENANCE_NOT_PACKAGE_REQUIRED',
    },
  ];

  for (const testCase of cases) {
    test(`FAIL: ${testCase.name}`, () => {
      const dir = makeFixtureDir();
      const fixture = buildReleaseFixture(dir, testCase.tamper);
      const result = runVerifier(fixture);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('PAYLOAD_GOVERNANCE_NO_GO');
      expect(gateStatus(result.output, 'manifest_provenance')).toBe('FAIL');
      expect(result.output).toContain(testCase.reason);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  test('PASS: evidência íntegra (default da fixture) → manifest_provenance PASS e total de gates é 24', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, {});
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(0);
    expect(gateStatus(result.output, 'manifest_provenance')).toBe('PASS');
    const gateLines = result.output.split('\n').filter((l) => /^\s+[✓✗] /.test(l));
    expect(gateLines).toHaveLength(24);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('consistency phase semantics — Caso I (PRE_PACKAGE nunca é FINAL)', () => {
  test('FAIL: relatório phase=FINAL com decisão DEFERRED → SEMANTIC_PHASE_MISMATCH', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, { consistencyPhase: 'FINAL' });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, 'consistency_phase_semantics')).toBe('FAIL');
    expect(result.output).toContain('SEMANTIC_PHASE_MISMATCH');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('FAIL: decisão DEFERRED sem phase (relatório legado) → SEMANTIC_PHASE_MISMATCH', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, { consistencyPhase: null, consistencyTransitional: false });
    const result = runVerifier(fixture);
    expect(result.exitCode).toBe(1);
    expect(gateStatus(result.output, 'consistency_phase_semantics')).toBe('FAIL');
    expect(result.output).toContain('SEMANTIC_PHASE_MISMATCH');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('PASS: decisão DEFERRED com phase=PRE_PACKAGE transitional=true (snapshot estrutural do payload)', () => {
    const dir = makeFixtureDir();
    const fixture = buildReleaseFixture(dir, {});
    const result = runVerifier(fixture);
    expect(gateStatus(result.output, 'consistency_phase_semantics')).toBe('PASS');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('validate-release-hygiene (standalone) — dist/ raiz sem artefato estrangeiro', () => {
  const VALIDATOR = path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'validate-release-hygiene.js');
  const { run } = require(VALIDATOR);

  function buildWorkspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-ws-'));
    const contentDir = path.join(root, 'content');
    fs.mkdirSync(contentDir, { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'file.txt'), 'ok');
    fs.mkdirSync(path.join(root, 'dist', 'release'), { recursive: true });
    fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'governance', '.current-run.json'),
      JSON.stringify({ runId: 'run-hygiene-x', sourceFingerprint: 'fp-hygiene-x' }),
    );
    for (const name of ['r-agent2-20260905-000000.zip', 'r-agent2-20260905-000000.payload.zip']) {
      execFileSync('zip', ['-q', path.join(root, 'dist', 'release', name), 'file.txt'], { cwd: contentDir });
    }
    return root;
  }

  function reportOf(root) {
    return JSON.parse(fs.readFileSync(path.join(root, 'reports', 'release-hygiene-report.json'), 'utf8'));
  }

  test('PASS: dist/ raiz limpa (artefatos governados apenas em dist/release/)', () => {
    const root = buildWorkspace();
    const code = run({ rootDir: root, reportPath: path.join(root, 'reports', 'release-hygiene-report.json') });
    expect(code).toBe(0);
    const report = reportOf(root);
    expect(report.status).toBe('PASS');
    expect(report.hygiene.foreignReleaseArtifacts).toBe(0);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('FAIL: zip cru nomeado como release solto na raiz de dist/ → FOREIGN_RELEASE_ARTIFACT', () => {
    const root = buildWorkspace();
    const contentDir = path.join(root, 'content');
    // snapshot ad-hoc (`npm run zip`) com timestamp MAIS NOVO que o release governado
    execFileSync('zip', ['-q', path.join(root, 'dist', 'r-agent2-20260905-174313.zip'), 'file.txt'], { cwd: contentDir });
    const code = run({ rootDir: root, reportPath: path.join(root, 'reports', 'release-hygiene-report.json') });
    expect(code).toBe(1);
    const report = reportOf(root);
    expect(report.status).toBe('FAIL');
    expect(report.issues.some((i) => i.rule === 'FOREIGN_RELEASE_ARTIFACT' && i.path === 'dist/r-agent2-20260905-174313.zip')).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('FAIL: manifest solto na raiz de dist/ → FOREIGN_RELEASE_ARTIFACT', () => {
    const root = buildWorkspace();
    fs.writeFileSync(path.join(root, 'dist', 'r-agent2-20260905-174313.manifest.json'), '{}');
    const code = run({ rootDir: root, reportPath: path.join(root, 'reports', 'release-hygiene-report.json') });
    expect(code).toBe(1);
    const report = reportOf(root);
    expect(report.issues.some((i) => i.rule === 'FOREIGN_RELEASE_ARTIFACT' && i.path.endsWith('.manifest.json'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
