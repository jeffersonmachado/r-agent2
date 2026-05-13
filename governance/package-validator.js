#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { findLatestReleaseArtifact, listArtifacts } = require('../tools/system/lib/release-artifact');

const ROOT = path.join(__dirname, '..');
const DEFAULT_REPORT_PATH = path.join(ROOT, 'governance', 'package-validation-report.json');

// ─── Self-containment: arquivos obrigatórios no filesystem antes de qualquer validação ──
const SELF_CONTAINMENT_REQUIRED = [
  { path: 'dist',                                       isDir: true,  label: 'dist/' },
  { path: 'governance/blocker-engine.js',               isDir: false, label: 'blocker-engine.js' },
  { path: 'governance/final-consistency-report.json',   isDir: false, label: 'final-consistency-report.json' },
  { path: 'governance/evidence-manifest.json',          isDir: false, label: 'evidence-manifest.json' },
  { path: 'governance/final-proof-report.json',         isDir: false, label: 'final-proof-report.json' },
  { path: 'governance/cross-report-validation.json',    isDir: false, label: 'cross-report-validation.json' },
  { path: 'governance/proof-signature.json',            isDir: false, label: 'proof-signature.json' },
];

function assertSelfContainment() {
  const missing = [];
  for (const entry of SELF_CONTAINMENT_REQUIRED) {
    const abs = path.join(ROOT, entry.path);
    const exists = entry.isDir ? fs.existsSync(abs) && fs.statSync(abs).isDirectory() : fs.existsSync(abs);
    if (!exists) missing.push(entry.label);
  }
  if (missing.length > 0) {
    throw new Error(`self_containment_failed:missing=[${missing.join(',')}]`);
  }
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
const DEFAULT_MANIFEST_PATH = path.join(ROOT, 'governance', 'evidence-manifest.json');

function loadSiblingArtifactManifest(zipPath) {
  const manifestPath = String(zipPath || '').replace(/\.zip$/i, '.manifest.json');
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    return { manifestPath, manifest: null };
  }

  try {
    return {
      manifestPath,
      manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
    };
  } catch (error) {
    throw new Error(`artifact_manifest_invalid:${manifestPath}:${error.message || error}`);
  }
}

function normalizeEntry(entry) {
  return String(entry || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function listZipEntries(zipPath) {
  const output = execFileSync('unzip', ['-Z1', zipPath], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split(/\r?\n/g)
    .map(normalizeEntry)
    .filter(Boolean);
}

function buildComparableEntrySet(entries) {
  const entrySet = new Set();
  for (const entry of entries) {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      continue;
    }

    entrySet.add(normalized);

    const slashIndex = normalized.indexOf('/');
    if (slashIndex > 0) {
      entrySet.add(normalized.slice(slashIndex + 1));
    }
  }
  return entrySet;
}

function loadEvidenceManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`evidence_manifest_invalid:${manifestPath}:${error.message || error}`);
  }
}

function resolveArtifactForValidation(options = {}) {
  if (options.zipPath) {
    const zipPath = path.resolve(ROOT, options.zipPath);
    if (!fs.existsSync(zipPath)) {
      throw new Error(`artifact_missing:${zipPath}`);
    }
    const sidecar = loadSiblingArtifactManifest(zipPath);
    return {
      zipPath,
      zip: path.basename(zipPath),
      manifestPath: sidecar.manifestPath,
      manifest: sidecar.manifest,
      selectionMode: 'explicit',
      candidateFallbackUsed: false,
      selectionError: null,
    };
  }

  const requireAuditPassed = options.requireAuditPassed !== false;
  const allowLatestCandidateFallback = options.allowLatestCandidateFallback !== false;

  try {
    const artifact = findLatestReleaseArtifact({ requireAuditPassed });
    return {
      ...artifact,
      selectionMode: requireAuditPassed ? 'audited' : 'candidate',
      candidateFallbackUsed: false,
      selectionError: null,
    };
  } catch (error) {
    if (!requireAuditPassed || !allowLatestCandidateFallback) {
      if (!requireAuditPassed) {
        const fallbackArtifact = listArtifacts()[0];
        if (fallbackArtifact) {
          return {
            ...fallbackArtifact,
            selectionMode: 'candidate',
            candidateFallbackUsed: true,
            selectionError: error.message || String(error),
          };
        }
      }
      throw error;
    }

    let artifact;
    try {
      artifact = findLatestReleaseArtifact({ requireAuditPassed: false });
    } catch (_) {
      artifact = listArtifacts()[0];
      if (!artifact) {
        throw error;
      }
    }
    return {
      ...artifact,
      selectionMode: 'candidate',
      candidateFallbackUsed: true,
      selectionError: error.message || String(error),
    };
  }
}

// ─── Verificação de self-containment antes de qualquer validação ──────────────
const SELF_CONTAINMENT_ENTRIES = [
  'governance/blocker-engine.js',
  'governance/final-consistency-report.json',
  'governance/final-proof-report.json',
  'governance/evidence-manifest.json',
  'governance/cross-report-validation.json',
  'governance/proof-signature.json',
];

function checkSelfContainment(zipEntrySet) {
  const missing = SELF_CONTAINMENT_ENTRIES.filter((entry) => !zipEntrySet.has(entry));
  return { passed: missing.length === 0, missing };
}

function validatePackage(options = {}) {
  // Enforça self-containment no filesystem antes de prosseguir
  if (!options.skipSelfContainmentCheck) {
    assertSelfContainment();
  }

  const artifact = resolveArtifactForValidation(options);
  const requireAuditPassed = options.requireAuditPassed !== false;
  const auditSatisfied = !requireAuditPassed || (artifact.manifest?.audit === 'passed' && artifact.candidateFallbackUsed !== true);

  const manifest = options.evidenceManifest || loadEvidenceManifest(options.manifestPath);
  const manifestEntries = Array.isArray(manifest?.artifacts)
    ? manifest.artifacts
      .filter((artifactRecord) => artifactRecord && artifactRecord.packageRequired === true)
      .map((artifactRecord) => artifactRecord.path)
    : [];

  const requiredEntries = Array.from(new Set([
    'governance/final-proof-report.json',
    'governance/evidence-manifest.json',
    'governance/blocker-engine.js',
    'governance/final-consistency-report.json',
    ...(options.requiredEntries || []),
    ...manifestEntries,
  ].map(normalizeEntry).filter(Boolean)));

  const zipEntries = listZipEntries(artifact.zipPath);
  const zipEntrySet = buildComparableEntrySet(zipEntries);
  const missingEntries = requiredEntries.filter((entry) => !zipEntrySet.has(entry));
  const selfContainment = checkSelfContainment(zipEntrySet);
  const zipSha256 = sha256File(artifact.zipPath);

  const selfContainmentPassed = selfContainment.passed;
  const ok = missingEntries.length === 0 && auditSatisfied && selfContainmentPassed;

  return {
    generatedAt: new Date().toISOString(),
    zipPath: artifact.zipPath,
    zipName: artifact.zip,
    zipSha256,
    selectionMode: artifact.selectionMode,
    candidateFallbackUsed: artifact.candidateFallbackUsed,
    manifestPath: artifact.manifestPath || null,
    manifestAudit: artifact.manifest?.audit || null,
    auditSatisfied,
    selfContainmentCheck: {
      passed: selfContainmentPassed,
      missing: selfContainment.missing,
    },
    requiredEntries,
    entryCount: zipEntries.length,
    missingEntries,
    ok,
    error: ok
      ? (artifact.selectionError || null)
      : (!auditSatisfied
        ? (artifact.selectionError || (artifact.candidateFallbackUsed ? 'artifact_selection_fell_back_to_candidate' : 'artifact_candidate_without_audit_passed'))
        : (!selfContainmentPassed ? `self_containment_failed:${selfContainment.missing.join(',')}` : (artifact.selectionError || null))),
    packageBinding: {
      boundTo: artifact.zip,
      sha256: zipSha256,
      immutable: true,
      selfProving: selfContainmentPassed,
      offlineAuditable: selfContainmentPassed,
    },
  };
}

function writeReport(report, reportPath = DEFAULT_REPORT_PATH) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function parseCliArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--zip') {
      options.zipPath = argv[index + 1];
      index += 1;
    } else if (arg === '--candidate') {
      options.requireAuditPassed = false;
    } else if (arg === '--audited-only') {
      options.requireAuditPassed = true;
      options.allowLatestCandidateFallback = false;
    } else if (arg === '--manifest') {
      options.manifestPath = argv[index + 1];
      index += 1;
    } else if (arg === '--skip-self-containment') {
      options.skipSelfContainmentCheck = true;
    }
  }

  return options;
}

if (require.main === module) {
  try {
    const report = validatePackage(parseCliArgs(process.argv.slice(2)));
    writeReport(report);
    // eslint-disable-next-line no-console
    console.log(`[package-validator] ok=${report.ok} zip=${report.zipName} sha256=${(report.zipSha256 || '').slice(0, 16)}… self-contained=${report.selfContainmentCheck?.passed} missing=${report.missingEntries.length}`);
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    const manifest = loadEvidenceManifest();
    const report = {
      generatedAt: new Date().toISOString(),
      ok: false,
      error: error.message || String(error),
      missingEntries: [],
      requiredEntries: Array.isArray(manifest?.artifacts)
        ? manifest.artifacts
          .filter((artifactRecord) => artifactRecord && artifactRecord.packageRequired === true)
          .map((artifactRecord) => artifactRecord.path)
        : [],
    };
    writeReport(report);
    // eslint-disable-next-line no-console
    console.error(`[package-validator] error=${report.error}`);
    process.exit(1);
  }
}

module.exports = {
  listZipEntries,
  buildComparableEntrySet,
  loadEvidenceManifest,
  resolveArtifactForValidation,
  validatePackage,
  writeReport,
};