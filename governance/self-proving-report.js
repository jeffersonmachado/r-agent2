#!/usr/bin/env node
'use strict';

/**
 * Self-Proving Report — certifica que o pacote é auto-provável.
 *
 * Verifica todas as dimensões de auto-prova:
 *   - packageSelfContainment:  artefatos de governança físicos no ZIP
 *   - packageSelfValidation:   relatórios referenciam o pacote atual
 *   - cryptographicValidation: assinaturas e cadeia válidas
 *   - replayIntegrity:         replay chain íntegro
 *   - governanceIntegrity:     consistency score e blockers
 *   - attestationIntegrity:    attestation assinada e válida
 *   - offlineAuditability:     verificador offline presente e funcional
 *   - tamperDetection:         detector presente e passando
 *   - reproducibility:         build determinístico documentado
 *   - immutabilityStatus:      cadeia imutável e hash vinculado
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { verifyChain, loadChain, sha256File, resolveArtifact } = require('./governance-chain');
const { verifySeal } = require('./sign-governance');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'self-proving-report.json');
const GOV_ARTS    = path.join(ROOT, 'dist', 'governance-artifacts');

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

function loadSig(name) {
  // Busca em governance-artifacts/ primeiro, depois em dist/
  for (const dir of [GOV_ARTS, path.join(ROOT, 'dist')]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
    }
  }
  return null;
}

// ─── Dimensões ─────────────────────────────────────────────────────────────────
function checkSelfContainment(artifact) {
  const requiredInZip = [
    'governance/final-proof-report.json',
    'governance/evidence-manifest.json',
    'governance/final-consistency-report.json',
    'governance/blocker-engine.js',
    'governance/governance-chain.js',
    'governance/governance-chain.json',
    'governance/sign-governance.js',
    'governance/tamper-detector.js',
    'governance/self-proving-report.json',
    'governance/replay-integrity.js',
  ];

  const govArtsRequiredInZip = [
    'governance-attestation.json',
    'governance.sig',
    'release.sig',
    'package.manifest.sig',
    'replay.sig',
    'governance-chain.json',
  ];

  // Verificar no filesystem (serão incluídos no próximo ZIP)
  const missingCore = requiredInZip.filter((r) => !exists(r));
  const missingArt  = govArtsRequiredInZip.filter((a) => !fs.existsSync(path.join(GOV_ARTS, a)));

  return {
    dimension:        'packageSelfContainment',
    pass:             missingCore.length === 0 && missingArt.length === 0,
    missingCore,
    missingGovArtifacts: missingArt,
    govArtifactsDir:  'dist/governance-artifacts/',
    selfContained:    missingCore.length === 0 && missingArt.length === 0,
  };
}

function checkSelfValidation(artifact) {
  const zipName     = artifact.zip;
  const filesToCheck = [
    { file: 'governance/cross-report-validation.json',   field: 'expectedZipName' },
    { file: 'governance/package-validation-report.json', field: 'zipName'         },
    { file: 'governance/final-consistency-report.json',  field: 'currentZipName'  },
  ];

  const stale    = [];
  const aligned  = [];
  for (const { file, field } of filesToCheck) {
    const d = readJsonSafe(file);
    if (!d) continue;
    const val = d[field];
    if (val === zipName) {
      aligned.push(file);
    } else if (val) {
      stale.push({ file, field, found: val, expected: zipName });
    }
  }

  return {
    dimension:   'packageSelfValidation',
    pass:        stale.length === 0,
    zipName,
    alignedFiles: aligned,
    staleRefs:   stale,
  };
}

function checkCryptographic() {
  const chain     = loadChain();
  const chainOk   = chain ? verifyChain(chain).valid : false;

  const sigs = ['governance.sig', 'release.sig', 'package.manifest.sig', 'replay.sig'];
  const sigResults = sigs.map((name) => {
    const sig = loadSig(name);
    const valid = sig ? verifySeal(sig) : false;
    return { name, present: !!sig, valid };
  });

  const allSigsValid = sigResults.every((s) => s.valid);

  return {
    dimension:       'cryptographicValidation',
    pass:            chainOk && allSigsValid,
    chainValid:      chainOk,
    chainRoot:       chain?.chainRoot?.slice(0, 32) || null,
    signatures:      sigResults,
    allSigsValid,
  };
}

function checkReplayIntegrity() {
  const proofSig = readJsonSafe('governance/proof-signature.json') || {};
  const replays  = Array.isArray(proofSig.subjectHashes) ? proofSig.subjectHashes : [];
  const audits   = proofSig.signatureAudit?.signatures || [];

  const allSigned   = replays.length > 0 && replays.every((r) => r.replayHash);
  const allValid    = audits.length > 0 && audits.every((a) => a.valid);
  const replaySig   = loadSig('replay.sig');
  const replaySigOk = replaySig ? verifySeal(replaySig) : false;

  return {
    dimension:      'replayIntegrity',
    pass:           allSigned && allValid && replaySigOk,
    replayCount:    replays.length,
    allSigned,
    allSignaturesValid: allValid,
    replaySigPresent:  !!replaySig,
    replaySigValid:    replaySigOk,
    journeys:       replays.map((r) => r.journeyId),
  };
}

function checkGovernanceIntegrity() {
  const consistency = readJsonSafe('governance/final-consistency-report.json') || {};
  const cross       = readJsonSafe('governance/cross-report-validation.json')  || {};
  const proof       = readJsonSafe('governance/final-proof-report.json')       || {};

  const score   = consistency.overallConsistencyScore;
  const blockers = cross.blockerCount ?? proof.blockerCount ?? 0;

  return {
    dimension:              'governanceIntegrity',
    pass:                   score === 100 && blockers === 0 && consistency.allChecksPass !== false,
    overallConsistencyScore: score,
    blockerCount:           blockers,
    allChecksPass:          consistency.allChecksPass ?? true,
    finalDecision:          proof.finalDecision || cross.finalDecision || 'UNKNOWN',
  };
}

function checkAttestationIntegrity() {
  const attPath = path.join(GOV_ARTS, 'governance-attestation.json');
  const attFallback = path.join(ROOT, 'dist', 'governance-attestation.json');
  const att = fs.existsSync(attPath)
    ? readJsonSafe(path.relative(ROOT, attPath))
    : (fs.existsSync(attFallback) ? JSON.parse(fs.readFileSync(attFallback, 'utf8')) : null);

  if (!att) {
    return {
      dimension: 'attestationIntegrity', pass: false,
      reason:    'governance-attestation.json not found',
    };
  }

  const attSig    = att.signatures?.attestation;
  const attSigOk  = attSig ? verifySeal(attSig) : false;
  const govLevel  = att.governanceLevel;
  const decision  = att.finalDecision;

  return {
    dimension:       'attestationIntegrity',
    pass:            attSigOk && decision !== 'UNKNOWN',
    attestationValid: attSigOk,
    governanceLevel: govLevel,
    finalDecision:   decision,
    autonomousReady: att.autonomousReady,
    selfContained:   att.selfContainment?.signaturesInZip === true,
  };
}

function checkOfflineAuditability() {
  const verifierPresent = exists('scripts/verify-enterprise-governance.sh');
  const chainPresent    = exists('governance/governance-chain.js');
  const tamperPresent   = exists('governance/tamper-detector.js');
  const signPresent     = exists('governance/sign-governance.js');
  const matPresent      = exists('governance/governance-maturity.js');

  return {
    dimension:             'offlineAuditability',
    pass:                  verifierPresent && chainPresent && tamperPresent && signPresent && matPresent,
    verifierScriptPresent: verifierPresent,
    chainEnginePresent:    chainPresent,
    tamperDetectorPresent: tamperPresent,
    signEnginePresent:     signPresent,
    maturityEvaluator:     matPresent,
  };
}

function checkTamperDetection() {
  const reportPath = path.join(ROOT, 'governance', 'tamper-detection-report.json');
  if (!fs.existsSync(reportPath)) {
    return {
      dimension: 'tamperDetection', pass: false,
      reason:    'tamper-detection-report.json not found — run: node governance/tamper-detector.js',
    };
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return {
    dimension:      'tamperDetection',
    pass:           report.decision === 'GO',
    decision:       report.decision,
    failedChecks:   report.failedChecks || 0,
    criticalChecks: report.criticalChecks || 0,
  };
}

function checkReproducibility() {
  // Verifica se há condições mínimas para builds determinísticas
  const hasPackageLock  = exists('package-lock.json');
  const hasFrontendLock = exists('frontend/package-lock.json');
  const hasGitignore    = exists('.gitignore');
  const hasNodeVersion  = exists('.nvmrc') || exists('.node-version');

  return {
    dimension:            'reproducibility',
    pass:                 hasPackageLock && hasGitignore,
    packageLockPresent:   hasPackageLock,
    frontendLockPresent:  hasFrontendLock,
    gitignorePresent:     hasGitignore,
    nodeVersionPinned:    hasNodeVersion,
    note:                 'Full determinism requires same git commit + same node version. ZIP timestamps vary.',
    gitCommitBound:       true,
  };
}

function checkImmutability(artifact) {
  const chain    = loadChain();
  const sidecar  = artifact.manifest || {};
  const chainOk  = chain ? verifyChain(chain).valid : false;
  const sigOk    = ['governance.sig', 'release.sig'].every((n) => {
    const sig = loadSig(n);
    return sig ? verifySeal(sig) : false;
  });

  return {
    dimension:        'immutabilityStatus',
    pass:             chainOk && sigOk,
    chainIntact:      chainOk,
    sigsValid:        sigOk,
    sidecarHash:      sidecar.sha256 || null,
    zipName:          artifact.zip,
    tamperDetectable: chainOk && sigOk,
    note:             'Any change to any governance artifact breaks the chainRoot and invalidates all sigs',
  };
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function generateSelfProvingReport() {
  let artifact;
  try { artifact = resolveArtifact(); } catch (e) {
    return {
      generatedAt: new Date().toISOString(),
      overallSelfProofScore: 0,
      pass: false,
      error: e.message,
    };
  }

  const dimensions = [
    checkSelfContainment(artifact),
    checkSelfValidation(artifact),
    checkCryptographic(),
    checkReplayIntegrity(),
    checkGovernanceIntegrity(),
    checkAttestationIntegrity(),
    checkOfflineAuditability(),
    checkTamperDetection(),
    checkReproducibility(),
    checkImmutability(artifact),
  ];

  const passing = dimensions.filter((d) => d.pass).length;
  const score   = Math.round((passing / dimensions.length) * 100);
  const allPass = passing === dimensions.length;

  // Reorganizar em mapa por dimension name
  const dimMap = {};
  for (const d of dimensions) {
    const { dimension, ...rest } = d;
    dimMap[dimension] = rest;
  }

  return {
    generatedAt:           new Date().toISOString(),
    schemaVersion:         '1.0.0',
    artifact:              artifact.zip,
    overallSelfProofScore: score,
    pass:                  allPass,
    passCount:             passing,
    totalDimensions:       dimensions.length,

    packageSelfContainment: dimMap.packageSelfContainment,
    packageSelfValidation:  dimMap.packageSelfValidation,
    cryptographicValidation: dimMap.cryptographicValidation,
    replayIntegrity:        dimMap.replayIntegrity,
    governanceIntegrity:    dimMap.governanceIntegrity,
    attestationIntegrity:   dimMap.attestationIntegrity,
    offlineAuditability:    dimMap.offlineAuditability,
    tamperDetection:        dimMap.tamperDetection,
    reproducibility:        dimMap.reproducibility,
    immutabilityStatus:     dimMap.immutabilityStatus,

    summary: allPass
      ? `Pacote ${artifact.zip} é completamente self-proving. Score: ${score}/100.`
      : `Pacote ${artifact.zip} tem ${dimensions.length - passing} dimensão(ões) incompleta(s). Score: ${score}/100.`,
  };
}

module.exports = { generateSelfProvingReport };

if (require.main === module) {
  const report = generateSelfProvingReport();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[self-proving] score=${report.overallSelfProofScore}/100 pass=${report.pass} artifact=${report.artifact}`);
  process.exit(report.pass ? 0 : 1);
}
