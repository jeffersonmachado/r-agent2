'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const DIST_DIR = path.join(ROOT, 'dist');

function readJsonFileStrict(filePath, label = path.basename(filePath)) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label}_missing:${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label}_invalid:${filePath}:${error.message || error}`);
  }
}

function listArtifacts() {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error(`dist_missing:${DIST_DIR}`);
  }

  return fs.readdirSync(DIST_DIR)
    .filter((name) => name.endsWith('.zip'))
    .sort()
    .reverse()
    .map((zip) => {
      const zipPath = path.join(DIST_DIR, zip);
      const manifestPath = path.join(DIST_DIR, zip.replace(/\.zip$/, '.manifest.json'));
      let manifest = null;
      let manifestError = null;
      try {
        manifest = readJsonFileStrict(manifestPath, 'artifact_manifest');
      } catch (error) {
        manifestError = error.message || String(error);
      }
      return {
        zip,
        zipPath,
        manifestPath,
        manifest,
        manifestError,
      };
    });
}

function findLatestReleaseArtifact(options = {}) {
  const requireAuditPassed = options.requireAuditPassed !== false;
  const requireGoNoGoGo = options.requireGoNoGoGo === true;
  const artifacts = listArtifacts();

  if (artifacts.length === 0) {
    throw new Error('artifact_missing:none_found_in_dist');
  }

  for (const artifact of artifacts) {
    if (!artifact.manifest) {
      continue;
    }
    const auditPassed = artifact.manifest.audit === 'passed';
    const goNoGo = String(artifact.manifest.goNoGo || '').toUpperCase();
    if (requireAuditPassed && !auditPassed) {
      continue;
    }
    if (requireGoNoGoGo && goNoGo !== 'GO') {
      continue;
    }
    return artifact;
  }

  if (requireGoNoGoGo) {
    throw new Error('artifact_missing:no_zip_with_audit_passed_and_go_no_go_go');
  }
  throw new Error('artifact_missing:no_zip_with_audit_passed');
}

function updateArtifactManifest(zipName, patch) {
  const manifestPath = path.join(DIST_DIR, zipName.replace(/\.zip$/, '.manifest.json'));
  const current = readJsonFileStrict(manifestPath, 'artifact_manifest');
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    manifestPath,
    manifest: next,
  };
}

function extractArtifact(zipPath, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  execFileSync('unzip', ['-q', zipPath, '-d', destinationDir], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

function resolveExtractedRoot(destinationDir) {
  const children = fs.readdirSync(destinationDir)
    .map((name) => path.join(destinationDir, name))
    .filter((childPath) => fs.statSync(childPath).isDirectory());

  if (children.length === 1) {
    return children[0];
  }

  const packageJsonPath = path.join(destinationDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    return destinationDir;
  }

  throw new Error(`artifact_extract_root_invalid:${destinationDir}`);
}

module.exports = {
  ROOT,
  DIST_DIR,
  readJsonFileStrict,
  listArtifacts,
  findLatestReleaseArtifact,
  updateArtifactManifest,
  extractArtifact,
  resolveExtractedRoot,
};