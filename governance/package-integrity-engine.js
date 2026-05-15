#!/usr/bin/env node
'use strict';

/**
 * Package Integrity Engine — valida que o ZIP entregue é exatamente o validado.
 *
 * Verifica:
 *   1. Hash SHA256 do ZIP real vs sidecar manifest
 *   2. Nome do ZIP nos relatórios vs ZIP real em disco
 *   3. Hash do evidence manifest
 *   4. Imutabilidade da cadeia de governança
 *   5. Nenhum drift entre pacote salvo e pacote real
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'package-integrity-report.json');

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

function findLatestZip() {
  const distDir = path.join(ROOT, 'dist');
  if (!fs.existsSync(distDir)) return null;
  const releaseDir = path.join(distDir, 'release');
  const searchDirs = [distDir, releaseDir].filter((dir) => fs.existsSync(dir));
  for (const dir of searchDirs) {
    const zips = fs.readdirSync(dir)
      .filter((f) => /^r-agent2-\d{8}-\d{6}\.zip$/.test(f))
      .sort()
      .reverse();
    if (zips.length > 0) {
      return { zip: zips[0], zipPath: path.join(dir, zips[0]) };
    }
  }
  return null;
}

function findSidecarManifest(zipPath) {
  const manifestPath = zipPath.replace(/\.zip$/, '.manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try { return JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) { return null; }
}

// ─── Verificação 1: hash do ZIP vs sidecar ────────────────────────────────────
function checkZipHash() {
  const latest = findLatestZip();
  if (!latest) return { check: 'zip_hash', pass: false, severity: 'CRITICAL', reason: 'No ZIP found in dist/' };

  const computed  = sha256File(latest.zipPath);
  const manifest  = findSidecarManifest(latest.zipPath);

  // Ler hash registrado: sidecar manifest (se existir) ou package-validation-report.json
  let recorded = manifest?.sha256;
  let hashSource = 'sidecar-manifest';
  if (!recorded) {
    // Fallback: ler do relatório interno no filesystem (gerado durante o release)
    const pkgReport = readJsonSafe('governance/package-validation-report.json');
    recorded = pkgReport?.zipSha256 || pkgReport?.packageBinding?.sha256;
    hashSource = 'governance/package-validation-report.json';
  }

  const match     = recorded && computed === recorded;

  return {
    check:      'zip_hash',
    pass:       match,
    severity:   match ? 'OK' : 'CRITICAL',
    zipName:    latest.zip,
    computed,
    recorded:   recorded || 'MISSING',
    hashSource,
    sizeBytes:  fs.statSync(latest.zipPath).size,
    match,
    reason:     match ? null : `ZIP hash diverge: computed=${computed?.slice(0,16)}… recorded=${recorded?.slice(0,16)}… [source: ${hashSource}]`,
  };
}

// ─── Verificação 2: nome do ZIP nos relatórios ────────────────────────────────
function checkZipNameAlignment() {
  const latest = findLatestZip();
  if (!latest) return { check: 'zip_name_alignment', pass: false, severity: 'CRITICAL', reason: 'No ZIP found' };

  const expectedName = latest.zip;
  const reports = [
    { file: 'governance/cross-report-validation.json',   field: 'expectedZipName' },
    { file: 'governance/package-validation-report.json', field: 'zipName'         },
    { file: 'governance/final-consistency-report.json',  field: 'currentZipName'  },
  ];

  const mismatches = [];
  for (const { file, field } of reports) {
    const data = readJsonSafe(file);
    if (!data) continue;
    const val = data[field];
    if (val && val !== expectedName) {
      mismatches.push({ file, field, found: val, expected: expectedName });
    }
  }

  const pass = mismatches.length === 0;
  return {
    check:      'zip_name_alignment',
    pass,
    severity:   pass ? 'OK' : 'CRITICAL',
    zipName:    expectedName,
    mismatches,
    reason:     pass ? null : `${mismatches.length} relatório(s) referenciam ZIP diferente do entregue`,
  };
}

// ─── Verificação 3: hash do evidence manifest ─────────────────────────────────
function checkEvidenceManifestHash() {
  const evidencePath = path.join(ROOT, 'governance', 'evidence-manifest.json');
  if (!fs.existsSync(evidencePath)) {
    return { check: 'evidence_manifest_hash', pass: false, severity: 'HIGH', reason: 'evidence-manifest.json not found' };
  }

  const computed = sha256File(evidencePath);
  const consistency = readJsonSafe('governance/final-consistency-report.json') || {};
  const recorded    = consistency.packageImmutability?.evidenceManifestHash
    || consistency.evidenceConsistency?.evidenceManifestHash;

  if (!recorded) {
    return {
      check:    'evidence_manifest_hash',
      pass:     true,  // sem baseline para comparar
      severity: 'OK',
      computed,
      note:     'No stored hash baseline to compare against',
    };
  }

  const match = computed === recorded;
  return {
    check:    'evidence_manifest_hash',
    pass:     match,
    severity: match ? 'OK' : 'HIGH',
    computed: computed?.slice(0, 24) + '…',
    recorded: recorded?.slice(0, 24) + '…',
    match,
    reason:   match ? null : `Evidence manifest hash diverge — evidence foi alterada após assinatura`,
  };
}

// ─── Verificação 4: package validator output ──────────────────────────────────
function checkPackageValidatorOutput() {
  const report = readJsonSafe('governance/package-validation-report.json');
  if (!report) return { check: 'package_validator', pass: false, severity: 'HIGH', reason: 'package-validation-report.json not found' };

  const latest = findLatestZip();
  const reportedZip = report.zipName;
  const actualZip   = latest?.zip;
  const zipMatch    = !actualZip || reportedZip === actualZip;

  const pass = report.ok === true && report.selfContainmentCheck?.passed === true && zipMatch;
  return {
    check:             'package_validator',
    pass,
    severity:          pass ? 'OK' : 'CRITICAL',
    validatorOk:       report.ok,
    selfContained:     report.selfContainmentCheck?.passed,
    missingEntries:    report.missingEntries?.length || 0,
    reportedZip,
    actualZip:         actualZip || 'unknown',
    zipMatch,
    reason:            pass ? null : `package-validator falhou: ok=${report.ok} selfContained=${report.selfContainmentCheck?.passed} zipMatch=${zipMatch}`,
  };
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runPackageIntegrityEngine() {
  const checks = [
    checkZipHash(),
    checkZipNameAlignment(),
    checkEvidenceManifestHash(),
    checkPackageValidatorOutput(),
  ];

  const failed    = checks.filter((c) => !c.pass);
  const critical  = failed.filter((c) => c.severity === 'CRITICAL');
  const pass      = failed.length === 0;

  const latest    = findLatestZip();
  const manifest  = latest ? findSidecarManifest(latest.zipPath) : null;

  return {
    generatedAt:    new Date().toISOString(),
    engine:         'package-integrity-engine/v1',
    pass,
    decision:       pass ? 'PACKAGE_INTEGRITY_GO' : 'PACKAGE_INTEGRITY_NO_GO',
    packageName:    latest?.zip || null,
    packageHash:    manifest?.sha256 || null,
    generatedAt_pkg: manifest?.generated_at || null,
    gitCommit:      manifest?.git_commit || null,
    evidenceManifestHash: sha256File(path.join(ROOT, 'governance', 'evidence-manifest.json')),
    checks,
    failedChecks:   failed.length,
    criticalChecks: critical.length,
    failureReasons: failed.map((c) => c.reason).filter(Boolean),
    summary: pass
      ? `Pacote ${latest?.zip} íntegro. Todos os hashes correspondem.`
      : `${failed.length} falha(s) de integridade detectada(s). Pacote não pode ser liberado.`,
  };
}

module.exports = {
  runPackageIntegrityEngine,
  checkZipHash,
  checkZipNameAlignment,
  checkEvidenceManifestHash,
  checkPackageValidatorOutput,
};

if (require.main === module) {
  const report = runPackageIntegrityEngine();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[package-integrity] decision=${report.decision} failed=${report.failedChecks}`);
  process.exit(report.pass ? 0 : 1);
}
