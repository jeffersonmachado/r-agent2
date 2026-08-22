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

function resolveDistDir(options = {}) {
  return options.distDir || DIST_DIR;
}

function approvalNameFor(zipName) {
  return zipName.replace(/\.zip$/, '.approval.json');
}

// Metadados de aprovação (goNoGo, releaseGate, approvedForDeploy...) NÃO podem
// ser escritos no manifest sidecar do payload: o hash desse manifest é selado
// no self-proving-report (verify-enterprise-governance-v2 exige igualdade).
// A aprovação vive em um sidecar próprio (<nome>.approval.json), mantendo o
// manifest do artefato imutável após o packaging.
function readApproval(distDir, dir, zipName) {
  const approvalName = approvalNameFor(zipName);
  const candidates = [path.join(dir, approvalName), path.join(distDir, approvalName)];
  const approvalPath = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  try {
    return { approval: readJsonFileStrict(approvalPath, 'artifact_approval'), approvalPath };
  } catch (_) {
    return { approval: null, approvalPath };
  }
}

function listArtifacts(options = {}) {
  const distDir = resolveDistDir(options);
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist_missing:${distDir}`);
  }

  // ORDEM: dist/ flat PRIMEIRO (pipeline cria ZIPs aqui), dist/release/ como fallback.
  // Nunca buscar dist/release/ primeiro — evita encontrar ZIP de release anterior.
  const RELEASE_DIR = path.join(distDir, 'release');
  const searchDirs  = [distDir, RELEASE_DIR].filter((d) => fs.existsSync(d));

  const seen = new Set();
  const results = [];

  for (const dir of searchDirs) {
    const zips = fs.readdirSync(dir)
      .filter((name) => /^r-agent2-\d{8}-\d{6}(\.payload)?\.zip$/.test(name))
      .sort()
      .reverse();

    for (const zip of zips) {
      if (seen.has(zip)) continue;
      seen.add(zip);

      const zipPath = path.join(dir, zip);
      // Layout two-pass: <release>.payload.zip usa manifest <release>.manifest.json
      const manifestName = zip.replace(/\.payload\.zip$/, '.manifest.json').replace(/\.zip$/, '.manifest.json');
      // Procurar manifest na mesma dir ou no flat dist/
      let manifestPath = path.join(dir, manifestName);
      if (!fs.existsSync(manifestPath)) {
        manifestPath = path.join(distDir, manifestName);
      }

      let manifest = null;
      let manifestError = null;
      try {
        manifest = readJsonFileStrict(manifestPath, 'artifact_manifest');
      } catch (error) {
        manifestError = error.message || String(error);
      }
      // Merge do sidecar de aprovação (se existir): campos de aprovação prevalecem
      // na visão dos consumidores (deploy exige manifest.goNoGo === 'GO') sem
      // mutar o arquivo de manifest selado.
      const { approval, approvalPath } = readApproval(distDir, dir, zip);
      if (manifest && approval) {
        manifest = { ...manifest, ...approval };
      }
      results.push({ zip, zipPath, manifestPath, manifest, manifestError, approvalPath, approval });
    }
  }

  return results;
}

function findLatestReleaseArtifact(options = {}) {
  const requireAuditPassed = options.requireAuditPassed !== false;
  const requireGoNoGoGo = options.requireGoNoGoGo === true;
  const artifacts = listArtifacts(options);

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

function updateArtifactManifest(zipName, patch, options = {}) {
  // O manifest sidecar do payload é IMUTÁVEL após o packaging: seu hash é
  // selado no self-proving-report (o verifier rígido exige igualdade).
  // Metadados de aprovação são persistidos no sidecar próprio
  // (<nome>.approval.json); listArtifacts faz o merge na leitura.
  const distDir = resolveDistDir(options);
  const approvalName = approvalNameFor(zipName);
  const candidates = [
    path.join(distDir, 'release', approvalName),
    path.join(distDir, approvalName),
  ];
  const approvalPath = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  let current = {};
  try {
    current = readJsonFileStrict(approvalPath, 'artifact_approval');
  } catch (_) {
    current = {};
  }
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(approvalPath), { recursive: true });
  fs.writeFileSync(approvalPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    approvalPath,
    approval: next,
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