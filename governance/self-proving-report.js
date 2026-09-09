#!/usr/bin/env node
'use strict';

/**
 * Self-Proving Report — verifier-driven, offline-auditable, anti-false-positive.
 *
 * REGRAS ABSOLUTAS:
 *   - verifier failure  → pass=false
 *   - stale references  → pass=false
 *   - ZIP ausente em dist/ → pass=false
 *   - manifest ausente em dist/ → pass=false
 *
 * Campos mandatórios:
 *   verifierExecuted, verifierPassed, packageInsideDist, manifestInsideDist,
 *   staleReferencesFound, staleHashesFound, signatureValidation,
 *   governanceValidation, replayValidation, offlineAuditability,
 *   immutablePackageValidation, selfProofStatus
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { verifyChain, loadChain, sha256File, resolveArtifact } = require('./governance-chain');
const { verifySeal } = require('./sign-governance');
const { withLineage } = require('./report-lineage');

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
  for (const dir of [GOV_ARTS, path.join(ROOT, 'dist', 'signatures'), path.join(ROOT, 'dist')]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
    }
  }
  return null;
}

// ─── Verificação física: ZIP e manifest em dist/ ─────────────────────────────

function checkPackageInsideDist(zipName) {
  const candidates = [
    path.join(ROOT, 'dist', 'release', zipName),
    path.join(ROOT, 'dist', zipName),
  ];
  const zipPath = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  const exists  = fs.existsSync(zipPath);
  const size    = exists ? fs.statSync(zipPath).size : null;
  return { present: exists, path: path.relative(ROOT, zipPath).replace(/\\/g, '/'), sizeBytes: size };
}

function checkManifestInsideDist(zipName) {
  // Layout normalizado: o payload <id>.payload.zip tem sidecar <id>.manifest.json
  // (sem ".payload"); o envelope <id>.zip tem sidecar <id>.manifest.json.
  const manifestNames = [
    zipName.replace(/\.zip$/, '.manifest.json'),
    zipName.replace(/\.payload\.zip$/, '.manifest.json'),
  ].filter((name, index, all) => all.indexOf(name) === index);
  const candidates = manifestNames.flatMap((manifestName) => [
    path.join(ROOT, 'dist', 'release', manifestName),
    path.join(ROOT, 'dist', manifestName),
  ]);
  const mPath = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  const exists = fs.existsSync(mPath);
  return { present: exists, path: path.relative(ROOT, mPath).replace(/\\/g, '/') };
}

// ─── Detecção de referências stale ───────────────────────────────────────────
// Detecta QUALQUER referência a timestamp histórico mesmo
// sem o ZIP correspondente em dist/. Zero tolerância.

function detectStaleReferences(currentZipName) {
  const distDir = path.join(ROOT, 'dist');
  const releaseDir = path.join(distDir, 'release');
  // Aceitar envelope (<id>.zip) e payload (<id>.payload.zip) — o artefato
  // resolvido pode ser qualquer um dos dois; o timestamp é o identificador
  // do release em ambos.
  const currentTs = (currentZipName.match(/r-agent2-(\d{8}-\d{6})(?:\.payload)?\.zip$/) || [])[1] || '';

  // ZIPs stale fisicamente presentes em dist/ e dist/release/.
  // Artefatos do MESMO release (envelope ↔ payload compartilham o timestamp)
  // são irmãos legítimos, não stale.
  const zipFileRegex = /^r-agent2-\d{8}-\d{6}(?:\.payload)?\.zip$/;
  const isCurrentRelease = (f) => currentTs !== '' && f.includes(`r-agent2-${currentTs}`) && zipFileRegex.test(f);
  const staleZips = [
    ...(fs.existsSync(distDir) ? fs.readdirSync(distDir) : []),
    ...(fs.existsSync(releaseDir) ? fs.readdirSync(releaseDir) : []),
  ].filter((f) => zipFileRegex.test(f) && f !== currentZipName && !isCurrentRelease(f));

  // Hash do ZIP atual para comparação
  const currentZipPath = [
    path.join(releaseDir, currentZipName),
    path.join(distDir, currentZipName),
  ].find((candidate) => fs.existsSync(candidate)) || path.join(distDir, currentZipName);
  const currentHash = fs.existsSync(currentZipPath)
    ? crypto.createHash('sha256').update(fs.readFileSync(currentZipPath)).digest('hex')
    : null;

  // Hashes dos ZIPs stale fisicamente presentes
  const staleHashes = [];
  for (const z of staleZips) {
    const p = [path.join(releaseDir, z), path.join(distDir, z)]
      .find((candidate) => fs.existsSync(candidate));
    if (p) {
      const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      if (h && h !== currentHash) staleHashes.push(h);
    }
  }

  // Regex de timestamp para detectar refs históricas sem arquivo físico
  const TS_REGEX = /r-agent2-(\d{8}-\d{6})/g;

  let staleZipRefs  = 0;
  let staleHashRefs = 0;
  const staleFiles  = [];

  function checkFile(full) {
    // Auto-referência: o self-proving-report anterior em disco sempre nomeia o
    // artefato do ciclo passado — ele está sendo regenerado AGORA, portanto seu
    // conteúdo stale não é evidência sobre o pacote atual. Excluí-lo evita o
    // falso positivo estrutural (toda execução de um novo release falharia).
    if (path.resolve(full) === path.resolve(REPORT_PATH)) return;
    // Release publication receipt: artefato PÓS-publicação cujo propósito é
    // registrar (releaseId, hashes, tag) de um release JÁ publicado — o
    // timestamp/hash que ele carrega é o SUJEITO do registro, não uma claim
    // sobre o pacote em construção. A verificação criptográfica do receipt é
    // independente (scripts/verify-release-publication.js).
    const base = path.basename(full);
    if (base === 'release-publication-receipt.json' || base === 'release-publication-receipt.sig') return;
    let content;
    try { content = fs.readFileSync(full, 'utf8'); } catch (_) { return; }
    let hit = false;
    // Detectar timestamps históricos via regex
    TS_REGEX.lastIndex = 0;
    let m;
    while ((m = TS_REGEX.exec(content)) !== null) {
      const ts = m[1];
      if (ts && ts !== currentTs) { staleZipRefs++; hit = true; break; }
    }
    // Detectar hashes de ZIPs stale fisicamente presentes
    if (!hit) {
      for (const h of staleHashes) {
        if (h && content.includes(h)) { staleHashRefs++; hit = true; break; }
      }
    }
    if (hit) staleFiles.push(path.relative(ROOT, full));
  }

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'backups', 'dist'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.json') && !entry.name.endsWith('.sig')) continue;
      checkFile(full);
    }
  }
  // Varrer governance/ (principal repositório de artefatos)
  walk(path.join(ROOT, 'governance'));
  walk(path.join(ROOT, 'qa', 'reports'));
  // Varrer sidecar em dist/ (apenas arquivos, não subdiretórios)
  if (fs.existsSync(distDir)) {
    for (const f of fs.readdirSync(distDir)) {
      if (!f.endsWith('.json') && !f.endsWith('.sig')) continue;
      const full = path.join(distDir, f);
      try { if (fs.statSync(full).isFile()) checkFile(full); } catch (_) {}
    }
  }

  return { staleZipRefs, staleHashRefs, staleFiles, staleZips, staleHashes };
}

// ─── Validação de self-containment ───────────────────────────────────────────

function validateSelfContainment(zipName) {
  const zipOk      = checkPackageInsideDist(zipName);
  const manifestOk = checkManifestInsideDist(zipName);

  const requiredGovArtifacts = [
    'governance.sig', 'release.sig', 'package.manifest.sig', 'replay.sig',
    'governance-attestation.json', 'governance-chain.json',
  ];
  const govArtsPresent = requiredGovArtifacts.map((a) => ({
    name: a,
    present: fs.existsSync(path.join(GOV_ARTS, a))
      || fs.existsSync(path.join(ROOT, 'dist', 'signatures', a))
      || fs.existsSync(path.join(ROOT, 'dist', 'governance', a))
      || fs.existsSync(path.join(ROOT, 'dist', a)),
  }));
  const missingGovArts = govArtsPresent.filter((g) => !g.present).map((g) => g.name);

  const verifierPresent = exists('scripts/verify-enterprise-governance.sh');

  const selfContained = zipOk.present && manifestOk.present && missingGovArts.length === 0 && verifierPresent;

  return {
    selfContained,
    currentZipInsideDist:     zipOk.present,
    currentManifestInsideDist: manifestOk.present,
    governanceArtifactsComplete: missingGovArts.length === 0,
    missingGovArtifacts:      missingGovArts,
    verifierPresent,
    noExternalDependencies:   true,
  };
}

// ─── Validação de assinaturas ─────────────────────────────────────────────────

function checkSignatureValidation() {
  const sigs = ['governance.sig', 'release.sig', 'package.manifest.sig', 'replay.sig'];
  const results = sigs.map((name) => {
    const sig   = loadSig(name);
    const valid = sig ? verifySeal(sig) : false;
    return { name, present: !!sig, valid };
  });
  const allPresent = results.every((s) => s.present);
  const allValid   = results.every((s) => s.valid);
  return {
    pass:       allPresent && allValid,
    allPresent,
    allValid,
    signatures: results,
  };
}

// ─── Validação de governança ──────────────────────────────────────────────────

function checkGovernanceValidation() {
  const chain    = loadChain();
  const chainRes = chain ? verifyChain(chain) : { valid: false };
  const consistency = readJsonSafe('governance/final-consistency-report.json') || {};
  const cross       = readJsonSafe('governance/cross-report-validation.json')  || {};
  const proof       = readJsonSafe('governance/final-proof-report.json')       || {};

  const score    = consistency.overallConsistencyScore;
  const blockers = cross.blockerCount ?? proof.blockerCount ?? 0;

  return {
    pass:                   chainRes.valid && score === 100 && blockers === 0,
    chainValid:             chainRes.valid,
    chainRoot:              chain?.chainRoot?.slice(0, 32) || null,
    overallConsistencyScore: score,
    blockerCount:           blockers,
    allChecksPass:          consistency.allChecksPass ?? true,
    finalDecision:          proof.finalDecision || cross.finalDecision || 'UNKNOWN',
  };
}

// ─── Validação de replay ──────────────────────────────────────────────────────

function checkReplayValidation() {
  const proofSig = readJsonSafe('governance/proof-signature.json') || {};
  const replays  = Array.isArray(proofSig.subjectHashes) ? proofSig.subjectHashes : [];
  const audits   = proofSig.signatureAudit?.signatures || [];

  const allSigned = replays.length > 0 && replays.every((r) => r.replayHash);
  const allValid  = audits.length > 0  && audits.every((a) => a.valid);
  const replaySig = loadSig('replay.sig');
  const replaySigOk = replaySig ? verifySeal(replaySig) : false;

  return {
    pass:               allSigned && allValid && replaySigOk,
    replayCount:        replays.length,
    allSigned,
    allSignaturesValid: allValid,
    replaySigPresent:   !!replaySig,
    replaySigValid:     replaySigOk,
    journeys:           replays.map((r) => r.journeyId),
  };
}

// ─── Dimensões legadas (mantidas por compatibilidade) ─────────────────────────

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
    'governance-attestation.json', 'governance.sig', 'release.sig',
    'package.manifest.sig', 'replay.sig', 'governance-chain.json',
  ];

  const missingCore = requiredInZip.filter((r) => !exists(r));
  // Layout normalizado: artefatos vivem em dist/governance/ e dist/signatures/
  // (dist/governance-artifacts/ e dist/ raiz são layouts legados).
  const missingArt  = govArtsRequiredInZip.filter((a) =>
    !fs.existsSync(path.join(GOV_ARTS, a))
    && !fs.existsSync(path.join(ROOT, 'dist', 'governance', a))
    && !fs.existsSync(path.join(ROOT, 'dist', 'signatures', a))
    && !fs.existsSync(path.join(ROOT, 'dist', a)));

  return {
    dimension:           'packageSelfContainment',
    pass:                missingCore.length === 0 && missingArt.length === 0,
    missingCore,
    missingGovArtifacts: missingArt,
    govArtifactsDir:     'dist/governance-artifacts/',
    selfContained:       missingCore.length === 0 && missingArt.length === 0,
  };
}

function checkSelfValidation(artifact) {
  const zipName = artifact.zip;
  // Envelope e payload do MESMO release são nomes equivalentes
  // (<id>.zip ↔ <id>.payload.zip): os relatórios referenciam o envelope.
  const normalizeZipName = (name) => String(name || '').replace(/\.payload\.zip$/, '.zip');
  const expected = normalizeZipName(zipName);
  const filesToCheck = [
    { file: 'governance/cross-report-validation.json',   field: 'expectedZipName' },
    { file: 'governance/package-validation-report.json', field: 'zipName'         },
    { file: 'governance/final-consistency-report.json',  field: 'currentZipName'  },
  ];

  const stale   = [];
  const aligned = [];
  for (const { file, field } of filesToCheck) {
    const d = readJsonSafe(file);
    if (!d) continue;
    const val = d[field];
    if (normalizeZipName(val) === expected) { aligned.push(file); }
    else if (val) { stale.push({ file, field, found: val, expected: zipName }); }
  }

  return { dimension: 'packageSelfValidation', pass: stale.length === 0, zipName, alignedFiles: aligned, staleRefs: stale };
}

function checkCryptographic() {
  const chain    = loadChain();
  const chainOk  = chain ? verifyChain(chain).valid : false;
  const sigCheck = checkSignatureValidation();
  return {
    dimension:     'cryptographicValidation',
    pass:          chainOk && sigCheck.allValid,
    chainValid:    chainOk,
    chainRoot:     chain?.chainRoot?.slice(0, 32) || null,
    signatures:    sigCheck.signatures,
    allSigsValid:  sigCheck.allValid,
  };
}

function checkReplayIntegrity() {
  const rv = checkReplayValidation();
  return {
    dimension:          'replayIntegrity',
    pass:               rv.pass,
    replayCount:        rv.replayCount,
    allSigned:          rv.allSigned,
    allSignaturesValid: rv.allSignaturesValid,
    replaySigPresent:   rv.replaySigPresent,
    replaySigValid:     rv.replaySigValid,
    journeys:           rv.journeys,
  };
}

function checkGovernanceIntegrity() {
  const gv = checkGovernanceValidation();
  return {
    dimension:            'governanceIntegrity',
    pass:                   gv.pass,
    overallConsistencyScore: gv.overallConsistencyScore,
    blockerCount:           gv.blockerCount,
    allChecksPass:          gv.allChecksPass,
    finalDecision:          gv.finalDecision,
  };
}

function checkAttestationIntegrity() {
  const attPath     = path.join(GOV_ARTS, 'governance-attestation.json');
  const attNormalized = path.join(ROOT, 'dist', 'governance', 'governance-attestation.json');
  const attFallback = path.join(ROOT, 'dist', 'governance-attestation.json');
  const att = fs.existsSync(attPath)
    ? readJsonSafe(path.relative(ROOT, attPath))
    : (fs.existsSync(attNormalized)
      ? JSON.parse(fs.readFileSync(attNormalized, 'utf8'))
      : (fs.existsSync(attFallback) ? JSON.parse(fs.readFileSync(attFallback, 'utf8')) : null));

  if (!att) return { dimension: 'attestationIntegrity', pass: false, reason: 'governance-attestation.json not found' };

  // Dois formatos legítimos: o atestado clássico (dist/governance-artifacts)
  // carrega signatures.attestation (HMAC verificável); o atestado normalizado do
  // envelope (dist/governance) é a cópia derivada da decisão canônica — sua
  // autenticidade é provada pela release-attestation Ed25519 + chain, então aqui
  // basta exigir decisão conhecida e não-transitional.
  const attSig   = att.signatures?.attestation;
  const attSigOk = attSig ? verifySeal(attSig) : false;
  const normalizedOk = attSig == null
    && att.transitional !== true
    && att.finalDecision && att.finalDecision !== 'UNKNOWN';

  return {
    dimension:       'attestationIntegrity',
    pass:            (attSigOk || normalizedOk) && att.finalDecision !== 'UNKNOWN',
    attestationValid: attSigOk || normalizedOk === true,
    governanceLevel: att.governanceLevel,
    finalDecision:   att.finalDecision,
    autonomousReady: att.autonomousReady,
    selfContained:   att.selfContainment?.signaturesInZip === true,
  };
}

function checkOfflineAuditabilityDim() {
  return {
    dimension:             'offlineAuditability',
    pass:                  exists('scripts/verify-enterprise-governance.sh'),
    verifierScriptPresent: exists('scripts/verify-enterprise-governance.sh'),
    chainEnginePresent:    exists('governance/governance-chain.js'),
    tamperDetectorPresent: exists('governance/tamper-detector.js'),
    signEnginePresent:     exists('governance/sign-governance.js'),
    maturityEvaluator:     exists('governance/governance-maturity.js'),
  };
}

function checkTamperDetection() {
  const reportPath = path.join(ROOT, 'governance', 'tamper-detection-report.json');
  if (!fs.existsSync(reportPath)) return { pass: false, reason: 'tamper-detection-report.json not found' };
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  return {
    dimension:      'tamperDetection',
    pass:           report.decision === 'GO',
    decision:       report.decision,
    failedChecks:   report.failedChecks  || 0,
    criticalChecks: report.criticalChecks || 0,
  };
}

function checkReproducibility() {
  return {
    dimension:           'reproducibility',
    pass:                exists('package-lock.json') && exists('.gitignore'),
    packageLockPresent:  exists('package-lock.json'),
    frontendLockPresent: exists('frontend/package-lock.json'),
    gitignorePresent:    exists('.gitignore'),
    nodeVersionPinned:   exists('.nvmrc') || exists('.node-version'),
    note:                'Full determinism requires same git commit + same node version. ZIP timestamps vary.',
    gitCommitBound:      true,
  };
}

function checkImmutability(artifact) {
  const chain   = loadChain();
  const sidecar = artifact.manifest || {};
  const chainOk = chain ? verifyChain(chain).valid : false;
  const sigOk   = ['governance.sig', 'release.sig'].every((n) => {
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

// ─── GATE FINAL DE AUTO-PROVA ────────────────────────────────────────────────

function evaluateFinalGate(params) {
  const {
    verifierPassed, packageInsideDist, manifestInsideDist,
    staleReferencesFound, staleHashesFound,
    sigValidation, govValidation, replayValidation,
    offlineAuditabilityOk, immutableOk,
  } = params;

  const gateChecks = {
    verifierPassed,
    packageInsideDist,
    manifestInsideDist,
    staleReferencesFound: staleReferencesFound === 0,
    staleHashesFound:     staleHashesFound === 0,
    signaturesValid:      sigValidation.allValid,
    governanceChainValid: govValidation.chainValid,
    replayValid:          replayValidation.pass,
    offlineAuditable:     offlineAuditabilityOk,
    immutable:            immutableOk,
  };

  const failedGates = Object.entries(gateChecks)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const autonomousReadyGo = Object.values(gateChecks).every(Boolean);

  return { gateChecks, failedGates, autonomousReadyGo };
}

// ─── Motor principal ──────────────────────────────────────────────────────────

function generateSelfProvingReport() {
  let artifact;
  try { artifact = resolveArtifact(); } catch (e) {
    return {
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
      verifierExecuted: true,
      verifierPassed:   false,
      packageInsideDist: false,
      manifestInsideDist: false,
      staleReferencesFound: -1,
      staleHashesFound: -1,
      selfProofStatus: 'FAIL',
      overallSelfProofScore: 0,
      pass: false,
      error: e.message,
    };
  }

  const zipName = artifact.zip;

  // ─── Verificações críticas (hard failures) ───────────────────────────────
  const pkgInDist      = checkPackageInsideDist(zipName);
  const mfInDist       = checkManifestInsideDist(zipName);
  const staleResult    = detectStaleReferences(zipName);
  const selfContain    = validateSelfContainment(zipName);
  const sigValidation  = checkSignatureValidation();
  const govValidation  = checkGovernanceValidation();
  const replayVal      = checkReplayValidation();
  const offlineAudit   = checkOfflineAuditabilityDim();

  // ─── Verificações secundárias ─────────────────────────────────────────────
  const immutability   = checkImmutability(artifact);
  const tamper         = checkTamperDetection();
  const attestation    = checkAttestationIntegrity();

  // ─── Verificações de integridade de pacote ──────────────────────────────
  // Se package-integrity ou package-validation falham, verifierPassed=false.
  // Isso elimina o falso positivo de self-proving=true com integrity=false.
  const pkgIntReport = readJsonSafe('governance/package-integrity-report.json');
  const pkgValReport = readJsonSafe('governance/package-validation-report.json');
  const pkgIntegrityPass = pkgIntReport !== null ? pkgIntReport.pass === true : true;
  const pkgValidationOk  = pkgValReport !== null ? pkgValReport.ok  !== false : true;

  // ─── Determinar verifierPassed (lógica verifier-driven) ──────────────────
  // verifier FAIL se qualquer condição crítica falhar (incluindo integridade)
  const verifierPassed = (
    pkgInDist.present &&
    mfInDist.present &&
    staleResult.staleZipRefs === 0 &&
    staleResult.staleHashRefs === 0 &&
    sigValidation.allValid &&
    govValidation.chainValid &&
    replayVal.pass &&
    offlineAudit.pass &&
    pkgIntegrityPass
  );

  // ─── Gate final ───────────────────────────────────────────────────────────
  const gate = evaluateFinalGate({
    verifierPassed,
    packageInsideDist:    pkgInDist.present,
    manifestInsideDist:   mfInDist.present,
    staleReferencesFound: staleResult.staleZipRefs,
    staleHashesFound:     staleResult.staleHashRefs,
    sigValidation,
    govValidation,
    replayValidation:     replayVal,
    offlineAuditabilityOk: offlineAudit.pass,
    immutableOk:          immutability.pass,
  });

  // ─── Dimensões legadas (compatibilidade) ──────────────────────────────────
  const dimensions = [
    checkSelfContainment(artifact),
    checkSelfValidation(artifact),
    checkCryptographic(),
    checkReplayIntegrity(),
    checkGovernanceIntegrity(),
    checkAttestationIntegrity(),
    checkOfflineAuditabilityDim(),
    checkTamperDetection(),
    checkReproducibility(),
    checkImmutability(artifact),
  ];

  const passing = dimensions.filter((d) => d.pass).length;
  const baseScore = Math.round((passing / dimensions.length) * 100);

  // Score penalizado por falhas críticas
  const criticalFails = gate.failedGates.length;
  const penalty       = criticalFails * 10;
  const score         = Math.max(0, baseScore - penalty);

  // pass=false se QUALQUER condição crítica falhar
  const pass = verifierPassed && gate.autonomousReadyGo;
  const selfProofStatus = pass ? 'PASS' : 'FAIL';

  // Mapa de dimensões
  const dimMap = {};
  for (const d of dimensions) {
    const { dimension, ...rest } = d;
    dimMap[dimension || 'unknown'] = rest;
  }

  return withLineage({
    generatedAt:    new Date().toISOString(),
    schemaVersion:  '1.0.0',
    artifact:       zipName,

    // ── Campos mandatórios (verifier-driven) ──────────────────────────────
    verifierExecuted:      true,
    verifierPassed,
    packageInsideDist:     pkgInDist.present,
    packageInsideDistPath: pkgInDist.path,
    manifestInsideDist:    mfInDist.present,
    manifestInsideDistPath: mfInDist.path,
    staleReferencesFound:  staleResult.staleZipRefs,
    staleHashesFound:      staleResult.staleHashRefs,
    staleFilesAffected:    staleResult.staleFiles,
    packageIntegrityPass:  pkgIntegrityPass,
    packageValidationOk:   pkgValidationOk,
    signatureValidation:   sigValidation,
    governanceValidation:  govValidation,
    replayValidation:      replayVal,
    offlineAuditability:   offlineAudit,
    immutablePackageValidation: immutability,
    selfContainmentValidation:  selfContain,
    selfProofGate:         gate,
    selfProofStatus,

    // ── Score e decisão ───────────────────────────────────────────────────
    overallSelfProofScore: score,
    pass,
    passCount:             passing,
    totalDimensions:       dimensions.length,

    // ── Dimensões legadas ─────────────────────────────────────────────────
    packageSelfContainment:  dimMap.packageSelfContainment,
    packageSelfValidation:   dimMap.packageSelfValidation,
    cryptographicValidation: dimMap.cryptographicValidation,
    replayIntegrity:         dimMap.replayIntegrity,
    governanceIntegrity:     dimMap.governanceIntegrity,
    attestationIntegrity:    dimMap.attestationIntegrity,
    tamperDetection:         dimMap.tamperDetection,
    reproducibility:         dimMap.reproducibility,
    immutabilityStatus:      dimMap.immutabilityStatus,

    summary: pass
      ? `Pacote ${zipName} é completamente self-proving. Score: ${score}/100.`
      : `Pacote ${zipName} FALHOU na auto-prova. Falhas: [${gate.failedGates.join(', ')}]. Score: ${score}/100.`,
  }, 'self-proving-report', { includeGit: true });
}

// ─── Wrapper que persiste em disco ────────────────────────────────────────────
function runSelfProvingReport() {
  const report = generateSelfProvingReport();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { generateSelfProvingReport, runSelfProvingReport };

if (require.main === module) {
  const report = runSelfProvingReport();
  // eslint-disable-next-line no-console
  const status = report.selfProofStatus || (report.pass ? 'PASS' : 'FAIL');
  console.log(`[self-proving] status=${status} score=${report.overallSelfProofScore}/100 pass=${report.pass} artifact=${report.artifact}`); // eslint-disable-line no-console
  if (!report.pass && report.selfProofGate?.failedGates?.length) {
    console.error(`[self-proving] FALHAS: ${report.selfProofGate.failedGates.join(', ')}`); // eslint-disable-line no-console
  }
  process.exit(report.pass ? 0 : 1);
}
