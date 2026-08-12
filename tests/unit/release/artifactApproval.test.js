'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  listArtifacts,
  findLatestReleaseArtifact,
  updateArtifactManifest,
} = require('../../../tools/system/lib/release-artifact');

const ZIP_NAME = 'r-agent2-20260101-000000.zip';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function makeDistFixture() {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragent2-dist-'));
  const releaseDir = path.join(distDir, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, ZIP_NAME), 'fake-payload-envelope');
  const manifest = {
    artifactType: 'payload',
    artifact: 'r-agent2-20260101-000000.payload.zip',
    sha256: 'abc123',
    generatedAt: '2026-01-01T00:00:00Z',
    governedArtifact: 'r-agent2-20260101-000000.payload.zip',
    status: 'immutable',
    audit: 'passed',
  };
  fs.writeFileSync(path.join(releaseDir, ZIP_NAME.replace(/\.zip$/, '.manifest.json')), `${JSON.stringify(manifest, null, 2)}\n`);
  return distDir;
}

describe('release-artifact approval sidecar', () => {
  test('updateArtifactManifest NÃO muta o manifest selado e grava approval sidecar', () => {
    const distDir = makeDistFixture();
    const manifestPath = path.join(distDir, 'release', ZIP_NAME.replace(/\.zip$/, '.manifest.json'));
    const hashBefore = sha256File(manifestPath);

    const result = updateArtifactManifest(ZIP_NAME, {
      goNoGo: 'GO',
      releaseGate: 'pass',
      approvedForDeploy: true,
    }, { distDir });

    // Manifest do artefato permanece byte-a-byte idêntico (hash selado no self-proving)
    expect(sha256File(manifestPath)).toBe(hashBefore);
    expect(result.approvalPath).toBe(path.join(distDir, 'release', ZIP_NAME.replace(/\.zip$/, '.approval.json')));
    expect(result.approval.goNoGo).toBe('GO');
    expect(result.approval.approvedForDeploy).toBe(true);
    expect(typeof result.approval.updatedAt).toBe('string');
    expect(fs.existsSync(result.approvalPath)).toBe(true);
  });

  test('listArtifacts faz merge do approval sidecar sem tocar o manifest em disco', () => {
    const distDir = makeDistFixture();
    const manifestPath = path.join(distDir, 'release', ZIP_NAME.replace(/\.zip$/, '.manifest.json'));
    const hashBefore = sha256File(manifestPath);

    const before = listArtifacts({ distDir });
    expect(before).toHaveLength(1);
    expect(before[0].manifest.goNoGo).toBeUndefined();

    updateArtifactManifest(ZIP_NAME, { goNoGo: 'GO', approvedForDeploy: true }, { distDir });

    const after = listArtifacts({ distDir });
    expect(after[0].manifest.goNoGo).toBe('GO');
    expect(after[0].manifest.approvedForDeploy).toBe(true);
    expect(after[0].manifest.audit).toBe('passed');
    expect(sha256File(manifestPath)).toBe(hashBefore);
  });

  test('findLatestReleaseArtifact com requireGoNoGoGo encontra artefato aprovado via sidecar', () => {
    const distDir = makeDistFixture();

    expect(() => findLatestReleaseArtifact({ distDir, requireAuditPassed: true, requireGoNoGoGo: true }))
      .toThrow(/no_zip_with_audit_passed_and_go_no_go_go/);

    updateArtifactManifest(ZIP_NAME, { goNoGo: 'GO', approvedForDeploy: true }, { distDir });

    const artifact = findLatestReleaseArtifact({ distDir, requireAuditPassed: true, requireGoNoGoGo: true });
    expect(artifact.zip).toBe(ZIP_NAME);
  });

  test('patches de aprovação são cumulativos no sidecar', () => {
    const distDir = makeDistFixture();

    updateArtifactManifest(ZIP_NAME, { goNoGo: 'GO' }, { distDir });
    const result = updateArtifactManifest(ZIP_NAME, { releaseGate: 'pass' }, { distDir });

    expect(result.approval.goNoGo).toBe('GO');
    expect(result.approval.releaseGate).toBe('pass');
  });
});
