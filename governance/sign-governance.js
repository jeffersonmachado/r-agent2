#!/usr/bin/env node
'use strict';

/**
 * Governance Signing Engine — HMAC-SHA256 sobre a cadeia de governança.
 *
 * Modelo criptográfico:
 *   key  = SHA256("rap-governance-v1:" + gitCommit)
 *   seal = HMAC-SHA256(key, chainRoot + ":" + zipName + ":" + timestamp)
 *
 * A chave é derivada deterministicamente do commit git. Qualquer auditor
 * que conheça o commit pode re-derivar a chave e verificar o seal offline.
 *
 * Outputs:
 *   dist/package.manifest.sig   — assinatura do manifesto
 *   dist/governance.sig         — assinatura da cadeia de governança
 *   dist/release.sig            — assinatura do release completo
 *   dist/governance-attestation.json — atestado enterprise completo
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const {
  buildChain,
  verifyChain,
  loadChain,
  writeChain,
  sha256File,
  sha256String,
  resolveArtifact,
} = require('./governance-chain');

const ROOT = path.join(__dirname, '..');

// ─── Derivação determinística de chave ────────────────────────────────────────
function deriveGovernanceKey(gitCommit) {
  return crypto.createHash('sha256')
    .update(`rap-governance-v1:${gitCommit}`)
    .digest();
}

function hmacSign(key, message) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

// ─── Assinatura de artefato individual ───────────────────────────────────────
function signArtifact({ subject, hash, chainRoot, gitCommit, timestamp, extra = '' }) {
  const key     = deriveGovernanceKey(gitCommit);
  const message = [subject, hash, chainRoot, timestamp, extra].filter(Boolean).join(':');
  const seal    = hmacSign(key, message);

  const result = {
    algorithm:    'hmac-sha256',
    keyDerivation: `sha256(rap-governance-v1:${gitCommit})`,
    subject,
    sha256:       hash,
    chainRoot,
    gitCommit,
    timestamp,
    seal,
    governanceLevel: 'LEVEL_4_IMMUTABLE',
    verificationNote: 'Re-derive key as SHA256("rap-governance-v1:" + gitCommit), then verify HMAC-SHA256(key, subject:sha256:chainRoot:timestamp[:extra])',
  };
  if (extra) result.extra = extra;
  return result;
}

// ─── Verificação de assinatura ────────────────────────────────────────────────
function verifySeal(sigObj) {
  if (!sigObj || !sigObj.seal || !sigObj.gitCommit) return false;
  const key     = deriveGovernanceKey(sigObj.gitCommit);
  const message = [sigObj.subject, sigObj.sha256, sigObj.chainRoot, sigObj.timestamp, sigObj.extra || '']
    .filter(Boolean).join(':');
  const expected = hmacSign(key, message);
  return expected === sigObj.seal;
}

// ─── Leitura de relatório JSON segura ────────────────────────────────────────
function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

// ─── Geração completa de assinaturas + atestado ───────────────────────────────
function signAll(options = {}) {
  const artifact  = resolveArtifact();
  const gitCommit = artifact.manifest?.git_commit
    || options.gitCommit
    || require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();

  // 1. Construir / atualizar cadeia
  const chain = buildChain(artifact);
  writeChain(chain);

  const ts         = new Date().toISOString();
  const zipName    = artifact.zip;
  const zipHash    = sha256File(artifact.zipPath);
  const chainRoot  = chain.chainRoot;

  // 2. Assinatura do manifesto sidecar
  const manifestHash = sha256File(artifact.manifestPath);
  const manifestSig  = signArtifact({
    subject:    `${zipName.replace(/\.zip$/, '.manifest.json')}`,
    hash:       manifestHash || '',
    chainRoot,
    gitCommit,
    timestamp:  ts,
  });

  // 3. Assinatura de governança (cadeia completa)
  const govSig = signArtifact({
    subject:    'governance-chain',
    hash:       chainRoot,
    chainRoot,
    gitCommit,
    timestamp:  ts,
    extra:      `links:${chain.chainLength}`,
  });

  // 4. Assinatura de release (pacote + cadeia)
  const releaseSig = signArtifact({
    subject:    zipName,
    hash:       zipHash || '',
    chainRoot,
    gitCommit,
    timestamp:  ts,
    extra:      `manifest:${manifestHash || ''}`,
  });

  // 5. Ler dados dos relatórios para o atestado
  const proofReport     = readJsonSafe(path.join(ROOT, 'governance', 'final-proof-report.json'))     || {};
  const consistencyRep  = readJsonSafe(path.join(ROOT, 'governance', 'final-consistency-report.json')) || {};
  const crossReport     = readJsonSafe(path.join(ROOT, 'governance', 'cross-report-validation.json')) || {};
  const proofSig        = readJsonSafe(path.join(ROOT, 'governance', 'proof-signature.json'))         || {};
  const blockersReport  = readJsonSafe(path.join(ROOT, 'governance', 'materialized-proof-artifacts-report.json')) || {};

  // 6. Atestado enterprise completo
  const attestationSeal = signArtifact({
    subject:    'governance-attestation',
    hash:       sha256String(JSON.stringify({
      zipName, zipHash, chainRoot, gitCommit,
      finalDecision: proofReport.finalDecision || 'UNKNOWN',
    })),
    chainRoot,
    gitCommit,
    timestamp:  ts,
    extra:      `decision:${proofReport.finalDecision || 'UNKNOWN'}`,
  });

  const attestation = {
    generatedAt:     ts,
    schemaVersion:   '1.0.0',
    governanceLevel: 'LEVEL_4_IMMUTABLE',

    packageIdentity: {
      name:      zipName,
      sha256:    zipHash,
      sizeBytes: fs.existsSync(artifact.zipPath) ? fs.statSync(artifact.zipPath).size : null,
      manifest:  artifact.manifestPath ? path.relative(ROOT, artifact.manifestPath) : null,
      audit:     artifact.manifest?.audit || 'unknown',
    },

    commitProvenance: {
      gitCommit,
      gitBranch:    artifact.manifest?.git_branch || 'main',
      generatedBy:  artifact.manifest?.generated_by || 'scripts/release-package.sh',
      generatedAt:  artifact.manifest?.generated_at || ts,
    },

    chainAttestation: {
      chainRoot,
      chainLength:    chain.chainLength,
      chainComplete:  chain.completeChain,
      chainValid:     chain.valid,
      missingLayers:  chain.missingLayers,
    },

    operationalCoverage: {
      replayCoverage:    proofReport.replayCoverage     || null,
      prodLikeCoverage:  proofReport.prodLikeCoverage   || null,
      proofCoverage:     proofReport.proofCoverage      || null,
      proofQualityScore: proofReport.proofQualityScore  || null,
      verticalCoverage:  proofReport.verticalCoverage   || null,
    },

    domainMaturity: {
      PBX: {
        maturityLevel: proofReport.PBXCoverage?.maturityLevel || 'unknown',
        isFullyReal:   proofReport.PBXCoverage?.isFullyReal   || false,
        status:        proofReport.PBXCoverage?.status        || 'UNKNOWN',
      },
      omnichannel: {
        status:      proofReport.omnichannelCoverage?.status      || 'UNKNOWN',
        sourceCount: proofReport.omnichannelCoverage?.sourceCount || 0,
      },
      humanHandoff: {
        status:            proofReport.humanHandoffCoverage?.status || 'UNKNOWN',
        normalizationGaps: (proofReport.humanHandoffCoverage?.normalizationGaps || []).length,
      },
      intelligence: {
        status:          proofReport.intelligenceStability?.status || 'UNKNOWN',
        unstableDomains: (proofReport.intelligenceStability?.unstableDomains || []).length,
        blocksAutonomous: proofReport.intelligenceStability?.blocksAutonomous || false,
      },
    },

    governanceIntegrity: {
      overallConsistencyScore: consistencyRep.overallConsistencyScore || null,
      blockerCount:            crossReport.blockerCount ?? proofReport.blockerCount ?? 0,
      allChecksPass:           consistencyRep.allChecksPass ?? true,
      replaySignature:         proofSig.signature || null,
      replaySignatureValid:    Array.isArray(proofSig.signatureAudit?.signatures)
        ? proofSig.signatureAudit.signatures.every((s) => s.valid)
        : null,
    },

    signatures: {
      manifest:    manifestSig,
      governance:  govSig,
      release:     releaseSig,
      attestation: attestationSeal,
    },

    finalDecision:   proofReport.finalDecision || 'UNKNOWN',
    autonomousReady: proofReport.finalDecision === 'AUTONOMOUS_READY_GO',

    verificationInstructions: [
      '1. Compute SHA256 of the ZIP file and compare with packageIdentity.sha256',
      '2. Run: node governance/governance-chain.js --verify',
      '3. Derive key: SHA256("rap-governance-v1:" + commitProvenance.gitCommit)',
      '4. Verify each sig: HMAC-SHA256(key, subject:sha256:chainRoot:timestamp)',
      '5. Run: bash scripts/verify-enterprise-governance.sh',
    ],
  };

  // Escrever outputs
  const distDir = path.join(ROOT, 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const write = (file, data) =>
    fs.writeFileSync(path.join(distDir, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  write('package.manifest.sig',       manifestSig);
  write('governance.sig',             govSig);
  write('release.sig',                releaseSig);
  write('governance-attestation.json', attestation);

  return {
    chain,
    attestation,
    signatures: { manifest: manifestSig, governance: govSig, release: releaseSig },
    outputs: [
      'dist/package.manifest.sig',
      'dist/governance.sig',
      'dist/release.sig',
      'dist/governance-attestation.json',
      'governance/governance-chain.json',
    ],
  };
}

module.exports = { signAll, signArtifact, verifySeal, deriveGovernanceKey };

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const verify = process.argv.includes('--verify');

  if (verify) {
    const distDir   = path.join(ROOT, 'dist');
    const relSigPath = path.join(distDir, 'release.sig');
    const govSigPath = path.join(distDir, 'governance.sig');

    let allValid = true;

    for (const sigPath of [relSigPath, govSigPath]) {
      if (!fs.existsSync(sigPath)) {
        // eslint-disable-next-line no-console
        console.error(`[sign-governance] Assinatura ausente: ${path.relative(ROOT, sigPath)}`);
        allValid = false;
        continue;
      }
      const sig   = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
      const valid = verifySeal(sig);
      // eslint-disable-next-line no-console
      console.log(`[sign-governance] ${path.basename(sigPath)}: ${valid ? 'VÁLIDA ✓' : 'INVÁLIDA ✗'}`);
      if (!valid) allValid = false;
    }

    process.exit(allValid ? 0 : 1);
  }

  const result = signAll();
  // eslint-disable-next-line no-console
  console.log(`[sign-governance] signed: ${result.outputs.join(', ')}`);
  // eslint-disable-next-line no-console
  console.log(`[sign-governance] chainRoot=${result.chain.chainRoot.slice(0, 16)}… decision=${result.attestation.finalDecision}`);
  process.exit(result.chain.valid ? 0 : 1);
}
