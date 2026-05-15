#!/usr/bin/env node
'use strict';

/**
 * Tamper Detector — detecta adulteração em qualquer artefato de governança.
 *
 * Compara hashes actuais contra a cadeia imutável armazenada.
 * Qualquer divergência gera NO_GO automático.
 *
 * Verifica:
 *   - adulteração de manifesto
 *   - adulteração de replay
 *   - adulteração de evidências
 *   - adulteração de proof reports
 *   - mutação de pacote
 *   - artefatos obsoletos
 *   - assinaturas inválidas
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { verifyChain, loadChain, sha256File, resolveArtifact } = require('./governance-chain');
const { verifySeal } = require('./sign-governance');

const ROOT = path.join(__dirname, '..');

const REPORT_PATH = path.join(ROOT, 'governance', 'tamper-detection-report.json');

// ─── Resolução de caminhos: suporta nova estrutura e compat flat ──────────────
function resolveSigPath(sigName) {
  const candidates = [
    path.join(ROOT, 'dist', 'signatures', sigName),    // nova estrutura
    path.join(ROOT, 'dist', sigName),                  // compat flat
    path.join(ROOT, 'dist', 'governance-artifacts', sigName), // legado
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[1];
}

function resolveGovPath(fileName) {
  const candidates = [
    path.join(ROOT, 'dist', 'governance', fileName),   // nova estrutura
    path.join(ROOT, 'dist', fileName),                 // compat flat
    path.join(ROOT, 'dist', 'governance-artifacts', fileName),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[1];
}

// ─── Verificações individuais ─────────────────────────────────────────────────
function checkPackageIntegrity(artifact) {
  const zipHash    = sha256File(artifact.zipPath);
  const manifest   = artifact.manifest || {};
  const recorded   = manifest.sha256;
  const match      = recorded && zipHash === recorded;

  return {
    check:    'package_integrity',
    pass:     match,
    severity: 'CRITICAL',
    details: {
      zipName:      artifact.zip,
      computedHash: zipHash,
      recordedHash: recorded || 'MISSING',
      match,
    },
  };
}

function checkManifestSig(artifact) {
  const sigPath = resolveSigPath('package.manifest.sig');
  if (!fs.existsSync(sigPath)) {
    return { check: 'manifest_sig', pass: false, severity: 'HIGH', details: { reason: 'sig_file_missing' } };
  }
  try {
    const sig   = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
    const valid = verifySeal(sig);
    const manifestHash = sha256File(artifact.manifestPath);
    const hashMatch    = sig.sha256 === manifestHash;
    return {
      check:    'manifest_sig',
      pass:     valid && hashMatch,
      severity: 'HIGH',
      details:  { valid, hashMatch, subject: sig.subject },
    };
  } catch (e) {
    return { check: 'manifest_sig', pass: false, severity: 'HIGH', details: { error: e.message } };
  }
}

function checkReleaseSig() {
  const sigPath = resolveSigPath('release.sig');
  if (!fs.existsSync(sigPath)) {
    return { check: 'release_sig', pass: false, severity: 'CRITICAL', details: { reason: 'sig_file_missing' } };
  }
  try {
    const sig   = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
    const valid = verifySeal(sig);
    return { check: 'release_sig', pass: valid, severity: 'CRITICAL', details: { valid, subject: sig.subject } };
  } catch (e) {
    return { check: 'release_sig', pass: false, severity: 'CRITICAL', details: { error: e.message } };
  }
}

function checkGovernanceSig() {
  const sigPath = resolveSigPath('governance.sig');
  if (!fs.existsSync(sigPath)) {
    return { check: 'governance_sig', pass: false, severity: 'CRITICAL', details: { reason: 'sig_file_missing' } };
  }
  try {
    const sig   = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
    const valid = verifySeal(sig);
    return { check: 'governance_sig', pass: valid, severity: 'CRITICAL', details: { valid, subject: sig.subject } };
  } catch (e) {
    return { check: 'governance_sig', pass: false, severity: 'CRITICAL', details: { error: e.message } };
  }
}

function checkImmutabilityChain() {
  const stored = loadChain();
  if (!stored) {
    return {
      check: 'immutability_chain', pass: false, severity: 'CRITICAL',
      details: { reason: 'chain_not_found', hint: 'Run: node governance/governance-chain.js' },
    };
  }
  const result = verifyChain(stored);
  return {
    check:    'immutability_chain',
    pass:     result.valid,
    severity: 'CRITICAL',
    details: {
      chainLength:     stored.chainLength,
      chainRootValid:  result.chainRootValid,
      tampered:        result.tampered,
      failures:        result.failures,
      storedChainRoot: stored.chainRoot?.slice(0, 24) + '…',
    },
  };
}

function checkReplaySignatures() {
  const sigPath = path.join(ROOT, 'governance', 'proof-signature.json');
  if (!fs.existsSync(sigPath)) {
    return { check: 'replay_signatures', pass: false, severity: 'HIGH', details: { reason: 'proof_signature_missing' } };
  }
  try {
    const sig    = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
    const audits = sig.signatureAudit?.signatures || [];
    const allValid = audits.length > 0 && audits.every((s) => s.valid);
    const invalid  = audits.filter((s) => !s.valid).map((s) => s.journeyId);
    return {
      check:    'replay_signatures',
      pass:     allValid,
      severity: 'HIGH',
      details: { totalReplays: audits.length, allValid, invalidReplays: invalid },
    };
  } catch (e) {
    return { check: 'replay_signatures', pass: false, severity: 'HIGH', details: { error: e.message } };
  }
}

function checkProofConsistency() {
  const consistency = (() => {
    const p = path.join(ROOT, 'governance', 'final-consistency-report.json');
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
  })();

  if (!consistency) {
    return { check: 'proof_consistency', pass: false, severity: 'CRITICAL', details: { reason: 'consistency_report_missing' } };
  }

  const score = consistency.overallConsistencyScore;
  return {
    check:    'proof_consistency',
    pass:     score === 100 && consistency.allChecksPass === true,
    severity: 'CRITICAL',
    details: {
      overallConsistencyScore: score,
      allChecksPass:           consistency.allChecksPass,
      finalDecision:           consistency.finalDecision,
    },
  };
}

function checkStaleArtifacts(artifact) {
  const zipName = artifact.zip;
  const filesToCheck = [
    { path: 'governance/cross-report-validation.json',    field: 'expectedZipName' },
    { path: 'governance/package-validation-report.json',  field: 'zipName' },
    { path: 'governance/final-consistency-report.json',   field: 'currentZipName' },
  ];

  const stale = [];
  for (const item of filesToCheck) {
    const abs = path.join(ROOT, item.path);
    if (!fs.existsSync(abs)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
      const val  = data[item.field];
      if (val && val !== zipName) {
        stale.push({ file: item.path, field: item.field, found: val, expected: zipName });
      }
    } catch (_) {
      // ignore parse errors in stale check
    }
  }

  return {
    check:    'stale_artifacts',
    pass:     stale.length === 0,
    severity: 'HIGH',
    details:  { staleCount: stale.length, stale },
  };
}

function checkAttestationIntegrity() {
  const attPath = resolveGovPath('governance-attestation.json');
  if (!fs.existsSync(attPath)) {
    return { check: 'attestation_integrity', pass: false, severity: 'HIGH', details: { reason: 'attestation_missing' } };
  }
  try {
    const att   = JSON.parse(fs.readFileSync(attPath, 'utf8'));
    const attSig = att.signatures?.attestation;
    if (!attSig) {
      return { check: 'attestation_integrity', pass: false, severity: 'HIGH', details: { reason: 'attestation_sig_missing' } };
    }
    const valid = verifySeal(attSig);
    return {
      check:    'attestation_integrity',
      pass:     valid,
      severity: 'HIGH',
      details:  { valid, finalDecision: att.finalDecision, governanceLevel: att.governanceLevel },
    };
  } catch (e) {
    return { check: 'attestation_integrity', pass: false, severity: 'HIGH', details: { error: e.message } };
  }
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runTamperDetection() {
  let artifact;
  try {
    artifact = resolveArtifact();
  } catch (e) {
    return {
      generatedAt: new Date().toISOString(),
      pass: false,
      decision: 'NO_GO',
      reason: `artifact_resolution_failed: ${e.message}`,
      checks: [],
    };
  }

  const checks = [
    checkPackageIntegrity(artifact),
    checkManifestSig(artifact),
    checkReleaseSig(),
    checkGovernanceSig(),
    checkImmutabilityChain(),
    checkReplaySignatures(),
    checkProofConsistency(),
    checkStaleArtifacts(artifact),
    checkAttestationIntegrity(),
  ];

  const failed   = checks.filter((c) => !c.pass);
  const critical = failed.filter((c) => c.severity === 'CRITICAL');
  const allPass  = failed.length === 0;

  return {
    generatedAt:    new Date().toISOString(),
    artifact:       artifact.zip,
    pass:           allPass,
    decision:       allPass ? 'GO' : 'NO_GO',
    totalChecks:    checks.length,
    failedChecks:   failed.length,
    criticalChecks: critical.length,
    checks,
    summary: allPass
      ? `Todos os ${checks.length} checks de integridade passaram. Nenhuma adulteração detectada.`
      : `${failed.length} check(s) falharam (${critical.length} críticos). Adulteração ou configuração incompleta detectada.`,
  };
}

module.exports = { runTamperDetection };

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const report = runTamperDetection();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[tamper-detector] decision=${report.decision} checks=${report.totalChecks} failed=${report.failedChecks}`);
  process.exit(report.pass ? 0 : 1);
}
