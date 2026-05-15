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

  // ORDEM: dist/ flat PRIMEIRO (pipeline cria ZIPs aqui), dist/release/ como fallback.
  // Nunca buscar dist/release/ primeiro — evita encontrar ZIP de release anterior.
  const RELEASE_DIR = path.join(DIST_DIR, 'release');
  const searchDirs  = [DIST_DIR, RELEASE_DIR].filter((d) => fs.existsSync(d));

  const seen = new Set();
  const results = [];

  for (const dir of searchDirs) {
    const zips = fs.readdirSync(dir)
      .filter((name) => /^r-agent2-\d{8}-\d{6}\.zip$/.test(name))
      .sort()
      .reverse();

    for (const zip of zips) {
      if (seen.has(zip)) continue;
      seen.add(zip);

      const zipPath = path.join(dir, zip);
      const manifestName = zip.replace(/\.zip$/, '.manifest.json');
      // Procurar manifest na mesma dir ou no flat dist/
      let manifestPath = path.join(dir, manifestName);
      if (!fs.existsSync(manifestPath)) {
        manifestPath = path.join(DIST_DIR, manifestName);
      }

      let manifest = null;
      let manifestError = null;
      try {
        manifest = readJsonFileStrict(manifestPath, 'artifact_manifest');
      } catch (error) {
        manifestError = error.message || String(error);
      }
      results.push({ zip, zipPath, manifestPath, manifest, manifestError });
    }
  }

  return results;
}

function findLatestReleaseArtifact(options = {}) {
  const requireAuditPassed = options.requireAuditPassed !== false;
  const requireGoNoGoGo = options.requireGoNoGoGo === true;
  const artifacts = listArtifacts();

  if (artifacts.length === 0) {
    throw new Error('artifact_missing:none_found_in_dist');
  }

  // Primeira passagem: preferir artefatos com manifest + audit=passed
  for (const artifact of artifacts) {
    if (!artifact.manifest) continue;
    const auditPassed = artifact.manifest.audit === 'passed';
    const goNoGo = String(artifact.manifest.goNoGo || '').toUpperCase();
    if (requireAuditPassed && !auditPassed) continue;
    if (requireGoNoGoGo && goNoGo !== 'GO') continue;
    return artifact;
  }

  if (requireGoNoGoGo) {
    throw new Error('artifact_missing:no_zip_with_audit_passed_and_go_no_go_go');
  }

  // Fallback: se não houver manifest, selecionar o ZIP mais recente e ler o
  // hash do package-validation-report.json interno (auto-comprovação sem sidecar).
  // Isso acontece quando o dist/ foi limpo pelo release pipeline (sem manifest).
  if (requireAuditPassed) {
    const { execFileSync } = require('child_process');
    for (const artifact of artifacts) {
      // Tentar ler hash do relatório interno ao ZIP
      try {
        const entries = execFileSync('unzip', ['-Z1', artifact.zipPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const hasPkgReport = entries.split('\n').some((e) => e.includes('governance/package-validation-report.json'));
        if (hasPkgReport) {
          const raw = execFileSync('unzip', ['-p', artifact.zipPath, `r-agent2/governance/package-validation-report.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          const pkgReport = JSON.parse(raw);
          // Sintetizar manifest a partir do relatório interno
          const syntheticManifest = {
            artifact:      artifact.zip,
            sha256:        pkgReport.zipSha256 || pkgReport.packageBinding?.sha256 || null,
            audit:         pkgReport.ok === true ? 'passed' : 'failed',
            generated_at:  pkgReport.generatedAt,
            git_commit:    null,
            git_branch:    'main',
            generated_by:  'internal:package-validation-report',
            synthetic:     true,
          };
          return { ...artifact, manifest: syntheticManifest, manifestPath: null };
        }
      } catch (_) {
        // ZIP não acessível ou malformado — continuar
      }
    }
  }

  // Último fallback: retornar o primeiro ZIP disponível como candidato
  if (artifacts.length > 0) {
    return { ...artifacts[0], selectionMode: 'candidate', candidateFallbackUsed: true };
  }

  throw new Error('artifact_missing:no_zip_found_in_dist');
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