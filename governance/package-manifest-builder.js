#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fingerprintObject } = require('../qa/coverage/fingerprints');
const { computeFingerprintChain } = require('./proof-engine/fingerprint-chain');

const MANIFEST_RELATIVE_PATH = 'governance/package-manifest.json';
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function readJson(rootDir, relPath) {
  const abs = path.join(rootDir, relPath);
  if (!fs.existsSync(abs)) throw new Error(`PACKAGE_REQUIRED_ARTIFACT_MISSING:${relPath}`);
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (error) {
    throw new Error(`PACKAGE_INVALID_JSON:${relPath}:${error.message}`);
  }
}

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function listPackageFiles(rootDir, dir = rootDir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      listPackageFiles(rootDir, abs, output);
    } else if (entry.isFile() && rel !== MANIFEST_RELATIVE_PATH) {
      output.push(rel);
    }
  }
  return output;
}

function computePackageFingerprint(rootDir) {
  const files = listPackageFiles(rootDir).sort().map((relPath) => [
    relPath,
    sha256File(path.join(rootDir, relPath)),
  ]);
  return fingerprintObject({ packageFiles: files });
}

function assertScorecardComplete(scorecard, run) {
  if (!scorecard.runId || scorecard.runId !== run.runId) {
    throw new Error('PACKAGE_SCORECARD_FOREIGN_RUN');
  }
  if (!scorecard.sourceFingerprint || scorecard.sourceFingerprint !== run.sourceFingerprint) {
    throw new Error('PACKAGE_SCORECARD_SOURCE_MISMATCH');
  }
  if (!Array.isArray(scorecard.dimensions) || scorecard.dimensions.length === 0) {
    throw new Error('PACKAGE_SCORECARD_EMPTY');
  }
  const below = scorecard.dimensions.filter((dimension) => Number(dimension.score ?? dimension.currentScore) !== 10);
  const mandatoryFailed = scorecard.dimensions.flatMap((dimension) =>
    (dimension.requirements || []).filter((requirement) => requirement.mandatory !== false && requirement.status !== 'PASS'));
  const blockers = scorecard.dimensions.flatMap((dimension) => dimension.blockers || []);
  if (below.length > 0 || mandatoryFailed.length > 0 || blockers.length > 0) {
    throw new Error('PACKAGE_SCORECARD_INCOMPLETE');
  }
}

function buildPackageManifest({ rootDir, sourceRoot = rootDir, createdAt = new Date().toISOString() }) {
  const run = readJson(rootDir, 'governance/.current-run.json');
  const proof = readJson(rootDir, 'governance/final-proof-report.json');
  const scorecard = readJson(rootDir, 'governance/rap-master-scorecard.json');

  if (!run.runId || !run.sourceFingerprint || run.status !== 'COMPLETED') {
    throw new Error('PACKAGE_RUN_NOT_COMPLETED');
  }

  const deliveredChain = computeFingerprintChain(rootDir);
  const sourceChain = computeFingerprintChain(sourceRoot);
  if (deliveredChain.sourceFingerprint !== sourceChain.sourceFingerprint
      || deliveredChain.sourceFingerprint !== run.sourceFingerprint) {
    throw new Error('PACKAGE_SOURCE_DRIFT');
  }
  if (!proof.runId || proof.runId !== run.runId || proof.sourceFingerprint !== run.sourceFingerprint) {
    throw new Error('PACKAGE_PROOF_LINEAGE_MISMATCH');
  }
  assertScorecardComplete(scorecard, run);

  const proofPath = path.join(rootDir, 'governance/final-proof-report.json');
  const scorecardPath = path.join(rootDir, 'governance/rap-master-scorecard.json');
  return {
    artifactType: 'rap-release-package-manifest',
    artifactVersion: '1.0.0',
    runId: run.runId,
    sourceFingerprint: run.sourceFingerprint,
    inventoryFingerprint: proof.inventoryFingerprint || deliveredChain.inventoryFingerprint,
    scenarioFingerprint: proof.scenarioFingerprint || deliveredChain.scenarioRegistryFingerprint,
    policyFingerprint: proof.policyFingerprint || deliveredChain.policyFingerprint,
    proofFingerprint: sha256File(proofPath),
    chainFingerprint: proof.chainFingerprint || deliveredChain.chainFingerprint,
    packageFingerprint: computePackageFingerprint(rootDir),
    scorecardFingerprint: sha256File(scorecardPath),
    createdAt,
  };
}

function writePackageManifest(options) {
  const manifest = buildPackageManifest(options);
  const output = path.join(options.rootDir, MANIFEST_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') args.rootDir = path.resolve(argv[++index]);
    else if (argv[index] === '--source-root') args.sourceRoot = path.resolve(argv[++index]);
  }
  return args;
}

module.exports = {
  MANIFEST_RELATIVE_PATH,
  computePackageFingerprint,
  buildPackageManifest,
  writePackageManifest,
  listPackageFiles,
};

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.rootDir) throw new Error('--root is required');
    const manifest = writePackageManifest(args);
    process.stdout.write(`[package-manifest] runId=${manifest.runId} packageFingerprint=${manifest.packageFingerprint}\n`);
  } catch (error) {
    process.stderr.write(`[package-manifest] FAIL ${error.message}\n`);
    process.exit(1);
  }
}
