'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { refreshManifestArtifacts } = require('../../../governance/export-governance-artifacts');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function makeRoot(withArtifacts = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-export-gov-'));
  fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governance', 'experience-segregation-report.json'), JSON.stringify({ status: 'PASS', violationCount: 0 }));
  if (withArtifacts) {
    fs.writeFileSync(path.join(root, 'governance', 'evidence-manifest.json'), JSON.stringify({
      artifactType: 'evidence-manifest',
      artifacts: [
        {
          id: 'experience_segregation',
          path: 'governance/experience-segregation-report.json',
          packageRequired: true,
          exists: true,
          hash: '0'.repeat(64),
          checksum: '0'.repeat(64),
          proofStatus: 'valid',
        },
        {
          id: 'missing_proof',
          path: 'governance/does-not-exist.json',
          packageRequired: false,
          exists: true,
          hash: '1'.repeat(64),
        },
      ],
    }));
  }
  return root;
}

describe('export-governance-artifacts — refreshManifestArtifacts', () => {
  it('preserva entradas packageRequired e refresca hash físico pós-stamp', () => {
    const root = makeRoot();
    const artifacts = refreshManifestArtifacts('governance/evidence-manifest.json', root);
    expect(artifacts).toHaveLength(2);

    const entry = artifacts.find((a) => a.id === 'experience_segregation');
    const physical = sha256File(path.join(root, 'governance', 'experience-segregation-report.json'));
    expect(entry.packageRequired).toBe(true);
    expect(entry.proofStatus).toBe('valid');
    expect(entry.exists).toBe(true);
    expect(entry.hash).toBe(physical);
    expect(entry.checksum).toBe(physical);
    expect(entry.hash).not.toBe('0'.repeat(64));

    const missing = artifacts.find((a) => a.id === 'missing_proof');
    expect(missing.exists).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('retorna null quando o manifest não existe ou não tem artifacts (comportamento legado)', () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-export-gov-empty-'));
    expect(refreshManifestArtifacts('governance/evidence-manifest.json', emptyRoot)).toBeNull();

    const noArtifacts = makeRoot(false);
    fs.writeFileSync(path.join(noArtifacts, 'governance', 'evidence-manifest.json'), JSON.stringify({ artifactType: 'evidence-manifest', status: 'PASS' }));
    expect(refreshManifestArtifacts('governance/evidence-manifest.json', noArtifacts)).toBeNull();

    fs.rmSync(emptyRoot, { recursive: true, force: true });
    fs.rmSync(noArtifacts, { recursive: true, force: true });
  });

  it('não quebra com manifest corrompido (fail-safe)', () => {
    const root = makeRoot(false);
    fs.writeFileSync(path.join(root, 'governance', 'evidence-manifest.json'), '{invalid json');
    expect(refreshManifestArtifacts('governance/evidence-manifest.json', root)).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
