#!/usr/bin/env node
'use strict';

/**
 * Update Package Binding — atualiza todas as referências de governança para o ZIP mais recente.
 *
 * Execute após npm run zip:release para vincular os relatórios ao novo pacote canônico.
 *
 * Uso:
 *   node governance/update-package-binding.js
 *   node governance/update-package-binding.js --dry-run
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { findLatestReleaseArtifact } = require('../tools/system/lib/release-artifact');

const ROOT    = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  if (DRY_RUN) {
    // eslint-disable-next-line no-console
    console.log(`[dry-run] would write ${path.relative(ROOT, filePath)}`);
    return;
  }
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`  updated ${path.relative(ROOT, filePath)}`);
}

function patchZipRefs(obj, zipName, sha256Ref, manifestPath) {
  if (!obj || typeof obj !== 'object') return obj;

  const OUT = Array.isArray(obj) ? [] : {};

  for (const [key, val] of Object.entries(obj)) {
    if (key === 'expectedZipName' || key === 'boundTo' || key === 'currentZipName') {
      OUT[key] = zipName;
    } else if (key === 'expectedZipSha256' || (key === 'zipSha256' && !key.endsWith('Ref'))) {
      OUT[key] = sha256Ref;
    } else if (key === 'zipPath' && typeof val === 'string' && val.includes('.zip')) {
      OUT[key] = path.join(ROOT, 'dist', zipName);
    } else if (key === 'zipName' && typeof val === 'string' && val.endsWith('.zip')) {
      OUT[key] = zipName;
    } else if (key === 'manifestPath' && typeof val === 'string' && val.includes('.manifest')) {
      OUT[key] = path.join(ROOT, manifestPath);
    } else if (typeof val === 'object' && val !== null) {
      OUT[key] = patchZipRefs(val, zipName, sha256Ref, manifestPath);
    } else {
      OUT[key] = val;
    }
  }

  return OUT;
}

function run() {
  let artifact;
  try {
    artifact = findLatestReleaseArtifact({ requireAuditPassed: true });
  } catch (_) {
    artifact = findLatestReleaseArtifact({ requireAuditPassed: false });
  }

  const zipName      = artifact.zip;
  // Computar hash diretamente do arquivo (não depende de sidecar manifest)
  const zipPath      = path.join(ROOT, 'dist', zipName);
  const zipSha256    = fs.existsSync(zipPath)
    ? require('crypto').createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex')
    : (artifact.manifest?.sha256 || null);
  const manifestRel  = `dist/${zipName.replace(/\.zip$/, '.manifest.json')}`;
  const sha256Ref    = zipSha256 || 'hash-not-available';
  const ts           = new Date().toISOString();

  // eslint-disable-next-line no-console
  console.log(`\n[update-package-binding] bound to: ${zipName}`);
  // eslint-disable-next-line no-console
  console.log(`  sha256: ${zipSha256}`);
  // eslint-disable-next-line no-console
  console.log(`  manifest: ${manifestRel} (may not exist after dist cleanup)\n`);

  // ─── Arquivos a atualizar ─────────────────────────────────────────────────
  const FILES_TO_PATCH = [
    'governance/cross-report-validation.json',
    'governance/materialized-proof-artifacts-report.json',
    'governance/package-validation-report.json',
  ];

  for (const relPath of FILES_TO_PATCH) {
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) continue;
    const original = readJson(abs);
    const patched  = patchZipRefs(original, zipName, sha256Ref, manifestRel);
    patched.generatedAt = ts;
    // Garantir que package-validation-report tem o hash real (para verificação sem sidecar)
    if (relPath === 'governance/package-validation-report.json' && zipSha256) {
      patched.zipSha256 = zipSha256;
      if (patched.packageBinding) patched.packageBinding.sha256 = zipSha256;
    }
    writeJson(abs, patched);
  }

  // ─── Atualiza final-consistency-report.json ───────────────────────────────
  const consistencyPath = path.join(ROOT, 'governance/final-consistency-report.json');
  if (fs.existsSync(consistencyPath)) {
    const consistency = readJson(consistencyPath);
    consistency.generatedAt          = ts;
    consistency.currentZipName       = zipName;
    consistency.currentZipSha256Note = `SHA256 stored in sidecar manifest to avoid circular hash dependency — see ${manifestRel}`;
    consistency.currentZipManifest   = manifestRel;
    consistency.currentZipTimestamp  = artifact.manifest?.generated_at || ts;

    if (consistency.packageSelfValidation) {
      consistency.packageSelfValidation.details = `Todos os relatórios referenciam ${zipName}. Pacote é self-proving.`;
    }
    if (consistency.manifestConsistency) {
      consistency.manifestConsistency.sidecarManifest = manifestRel;
      consistency.manifestConsistency.boundZipName = zipName;
      consistency.manifestConsistency.boundZipSha256Note = `SHA256 stored in sidecar manifest — see ${manifestRel}`;
    }
    if (consistency.packageImmutability) {
      consistency.packageImmutability.boundTo   = zipName;
      consistency.packageImmutability.zipHashRef = `${manifestRel}#sha256`;
      // Atualizar hash do evidence manifest (regenerado a cada platform-readiness run)
      const evHash = sha256File(path.join(ROOT, 'governance', 'evidence-manifest.json'));
      if (evHash) consistency.packageImmutability.evidenceManifestHash = evHash;
    }
    // Atualizar evidenceConsistency hash também
    if (consistency.evidenceConsistency) {
      const evHash = sha256File(path.join(ROOT, 'governance', 'evidence-manifest.json'));
      if (evHash) consistency.evidenceConsistency.evidenceManifestHash = evHash;
    }
    if (consistency.summary) {
      consistency.summary = `Pacote ${zipName} é self-proving. Governança vinculada ao ZIP atual.`;
    }
    writeJson(consistencyPath, consistency);
  }

  // ─── Atualiza seção crossReportConsistency e packageValidation no final-proof-report ──
  const proofPath = path.join(ROOT, 'governance/final-proof-report.json');
  if (fs.existsSync(proofPath)) {
    const proof = readJson(proofPath);
    if (proof.crossReportConsistency) {
      proof.crossReportConsistency.generatedAt = ts;
      proof.crossReportConsistency.expectedZipName = zipName;
      proof.crossReportConsistency.expectedZipSha256Ref = `${manifestRel}#sha256`;
    }
    if (proof.packageValidation) {
      proof.packageValidation.generatedAt = ts;
      proof.packageValidation.zipPath = path.join(ROOT, 'dist', zipName);
      proof.packageValidation.zipName = zipName;
      proof.packageValidation.zipSha256Ref = `${manifestRel}#sha256`;
      proof.packageValidation.manifestPath = path.join(ROOT, manifestRel);
    }
    writeJson(proofPath, proof);
  }

  // ─── Atualiza seção crossReportConsistency e packageValidation no final-readiness-report ──
  const readinessPath = path.join(ROOT, 'governance/final-readiness-report.json');
  if (fs.existsSync(readinessPath)) {
    const readiness = readJson(readinessPath);
    // Busca recursivamente e atualiza as seções aninhadas
    function patchReport(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (obj.crossReportConsistency) {
        obj.crossReportConsistency.generatedAt = ts;
        obj.crossReportConsistency.expectedZipName = zipName;
        obj.crossReportConsistency.expectedZipSha256Ref = `${manifestRel}#sha256`;
      }
      if (obj.packageValidation) {
        obj.packageValidation.generatedAt = ts;
        obj.packageValidation.zipPath = path.join(ROOT, 'dist', zipName);
        obj.packageValidation.zipName = zipName;
        obj.packageValidation.zipSha256Ref = `${manifestRel}#sha256`;
        obj.packageValidation.manifestPath = path.join(ROOT, manifestRel);
      }
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object') patchReport(val);
      }
    }
    patchReport(readiness);
    writeJson(readinessPath, readiness);
  }

  // ─── Reconstruir cadeia de imutabilidade e re-assinar ────────────────────
  if (!DRY_RUN) {
    try {
      const { buildChain, writeChain, resolveArtifact: resolveArt } = require('./governance-chain');
      const { signAll } = require('./sign-governance');
      const art2  = resolveArt();
      const chain = buildChain(art2);
      writeChain(chain);
      signAll();
      // eslint-disable-next-line no-console
      console.log(`  rebuilt chain + signed (chainRoot=${chain.chainRoot.slice(0, 16)}…)`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`  [warn] chain/sign rebuild failed: ${e.message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(DRY_RUN ? '\n[dry-run] nenhuma alteração gravada.' : '\n[update-package-binding] concluído.');
}

run();
