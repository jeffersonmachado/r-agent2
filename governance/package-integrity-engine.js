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
const { withLineage } = require('./report-lineage');
const { evaluateEvidenceManifestHashBaseline } = require('./lib/evidence-manifest-hash-baseline');

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
  // Layout normalizado: dist/release/<nome>.payload.zip é o artefato governado;
  // o envelope <nome>.zip só existe na raiz de dist/ antes da normalização.
  const searchDirs = [releaseDir, distDir].filter((dir) => fs.existsSync(dir));
  for (const dir of searchDirs) {
    const zips = fs.readdirSync(dir)
      .filter((f) => /^r-agent2-\d{8}-\d{6}(\.payload)?\.zip$/.test(f))
      .sort()
      .reverse();
    if (zips.length > 0) {
      return { zip: zips[0], zipPath: path.join(dir, zips[0]) };
    }
  }
  return null;
}

function findSidecarManifest(zipPath) {
  const candidates = [
    zipPath.replace(/\.zip$/, '.manifest.json'),
    zipPath.replace(/\.payload\.zip$/, '.manifest.json'),
  ].filter((candidate, index, all) => all.indexOf(candidate) === index);
  const manifestPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!manifestPath) return null;
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
  // Envelope e payload do MESMO release são nomes equivalentes
  // (<id>.zip ↔ <id>.payload.zip): relatórios gerados antes da normalização
  // referenciam o envelope; o artefato governado entregue é o payload.
  // A comparação normaliza o sufixo — timestamp divergente continua falhando.
  const normalizeZipName = (name) => String(name || '').replace(/\.payload\.zip$/, '.zip');
  const expectedNormalized = normalizeZipName(expectedName);
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
    if (val && normalizeZipName(val) !== expectedNormalized) {
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
//
// A decisão vive em `governance/lib/evidence-manifest-hash-baseline.js` (módulo
// puro, testável offline). Aqui só se lê o disco: hash atual, baseline atestado
// (`packageImmutability`/`evidenceConsistency` do final-consistency-report) e o
// run corrente. Antes o baseline era apenas LIDO e nenhum produtor o criava — a
// ausência virava PASS e o check não podia falhar.
function checkEvidenceManifestHash() {
  const computed    = sha256File(path.join(ROOT, 'governance', 'evidence-manifest.json'));
  const consistency = readJsonSafe('governance/final-consistency-report.json') || {};
  const baseline    = consistency.packageImmutability || consistency.evidenceConsistency || null;
  const currentRun  = readJsonSafe('governance/.current-run.json');

  const verdict = evaluateEvidenceManifestHashBaseline({ computed, baseline, currentRun });
  const recorded = baseline && baseline.evidenceManifestHash ? String(baseline.evidenceManifestHash) : null;

  return {
    check:    'evidence_manifest_hash',
    pass:     verdict.pass,
    severity: verdict.severity,
    code:     verdict.code,
    computed: computed ? `${computed.slice(0, 24)}…` : null,
    recorded: recorded ? `${recorded.slice(0, 24)}…` : null,
    reason:   verdict.reason,
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

  return withLineage({
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
  }, 'package-integrity-report', { includeGit: true });
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
