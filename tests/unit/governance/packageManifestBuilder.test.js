'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  computePackageFingerprint,
  buildPackageManifest,
} = require('../../../governance/package-manifest-builder');
const { computeFingerprintChain } = require('../../../governance/proof-engine/fingerprint-chain');

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(root, relPath, value) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, relPath, value) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, value);
}

function buildValidRoots() {
  const sourceRoot = tempRoot('rap-package-source-');
  const packageRoot = tempRoot('rap-package-stage-');
  for (const root of [sourceRoot, packageRoot]) {
    writeText(root, 'api/app/example.js', "'use strict';\nmodule.exports = 1;\n");
  }
  const chain = computeFingerprintChain(sourceRoot);
  const run = {
    runId: 'rap-release-20260821-120000-abcd1234',
    sourceFingerprint: chain.sourceFingerprint,
    startedAt: '2026-08-21T12:00:00.000Z',
    status: 'COMPLETED',
  };
  writeJson(packageRoot, 'governance/.current-run.json', run);
  writeJson(packageRoot, 'governance/final-proof-report.json', {
    artifactType: 'final-proof',
    artifactVersion: '1.0.0',
    runId: run.runId,
    sourceFingerprint: chain.sourceFingerprint,
    inventoryFingerprint: chain.inventoryFingerprint,
    scenarioFingerprint: chain.scenarioRegistryFingerprint,
    policyFingerprint: chain.policyFingerprint,
    chainFingerprint: chain.chainFingerprint,
  });
  writeJson(packageRoot, 'governance/rap-master-scorecard.json', {
    artifactType: 'rap-master-scorecard',
    artifactVersion: '1.0.0',
    runId: run.runId,
    sourceFingerprint: chain.sourceFingerprint,
    dimensions: [{ id: 'RAP-001', score: 10, requirements: [{ mandatory: true, status: 'PASS' }], blockers: [] }],
    summary: { totalDimensions: 1, dimensionsAt10: 1, dimensionsBelow10: 0, openGaps: 0, openBlockers: 0 },
  });
  return { sourceRoot, packageRoot, chain, run };
}

describe('package-manifest-builder', () => {
  test('packageFingerprint muda com payload e ignora o próprio manifest', () => {
    const root = tempRoot('rap-package-fingerprint-');
    writeText(root, 'api/example.js', 'one');
    const first = computePackageFingerprint(root);
    writeJson(root, 'governance/package-manifest.json', { packageFingerprint: 'placeholder' });
    expect(computePackageFingerprint(root)).toBe(first);
    writeText(root, 'api/example.js', 'two');
    expect(computePackageFingerprint(root)).not.toBe(first);
  });

  test('manifest deriva toda lineage do mesmo run e do source entregue', () => {
    const { sourceRoot, packageRoot, chain, run } = buildValidRoots();
    const manifest = buildPackageManifest({ rootDir: packageRoot, sourceRoot });
    expect(manifest).toEqual(expect.objectContaining({
      artifactType: 'rap-release-package-manifest',
      runId: run.runId,
      sourceFingerprint: chain.sourceFingerprint,
      chainFingerprint: chain.chainFingerprint,
      packageFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      scorecardFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      proofFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  test('rejeita scorecard incompleto e source drift', () => {
    const first = buildValidRoots();
    const scorecardPath = path.join(first.packageRoot, 'governance/rap-master-scorecard.json');
    const scorecard = JSON.parse(fs.readFileSync(scorecardPath, 'utf8'));
    scorecard.dimensions[0].score = 9;
    scorecard.summary.dimensionsAt10 = 0;
    scorecard.summary.dimensionsBelow10 = 1;
    writeJson(first.packageRoot, 'governance/rap-master-scorecard.json', scorecard);
    expect(() => buildPackageManifest({ rootDir: first.packageRoot, sourceRoot: first.sourceRoot }))
      .toThrow('PACKAGE_SCORECARD_INCOMPLETE');

    const second = buildValidRoots();
    writeText(second.packageRoot, 'api/app/example.js', "'use strict';\nmodule.exports = 2;\n");
    expect(() => buildPackageManifest({ rootDir: second.packageRoot, sourceRoot: second.sourceRoot }))
      .toThrow('PACKAGE_SOURCE_DRIFT');
  });
});
