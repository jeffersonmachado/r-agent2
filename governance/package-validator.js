#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { findLatestReleaseArtifact, listArtifacts } = require('../tools/system/lib/release-artifact');

const ROOT = path.join(__dirname, '..');
const DEFAULT_REPORT_PATH = path.join(ROOT, 'governance', 'package-validation-report.json');
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

function validatePackage(options = {}) {
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
    ...(options.requiredEntries || []),
    ...manifestEntries,
  ].map(normalizeEntry).filter(Boolean)));

  const zipEntries = listZipEntries(artifact.zipPath);
  const zipEntrySet = buildComparableEntrySet(zipEntries);
  const missingEntries = requiredEntries.filter((entry) => !zipEntrySet.has(entry));

  return {
    generatedAt: new Date().toISOString(),
    zipPath: artifact.zipPath,
    zipName: artifact.zip,
    selectionMode: artifact.selectionMode,
    candidateFallbackUsed: artifact.candidateFallbackUsed,
    manifestPath: artifact.manifestPath || null,
    manifestAudit: artifact.manifest?.audit || null,
    auditSatisfied,
    requiredEntries,
    entryCount: zipEntries.length,
    missingEntries,
    ok: missingEntries.length === 0 && auditSatisfied,
    error: auditSatisfied
      ? artifact.selectionError
      : (artifact.selectionError || (artifact.candidateFallbackUsed ? 'artifact_selection_fell_back_to_candidate' : 'artifact_candidate_without_audit_passed')),
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
    }
  }

  return options;
}

if (require.main === module) {
  try {
    const report = validatePackage(parseCliArgs(process.argv.slice(2)));
    writeReport(report);
    // eslint-disable-next-line no-console
    console.log(`[package-validator] ok=${report.ok} zip=${report.zipName} missing=${report.missingEntries.length}`);
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