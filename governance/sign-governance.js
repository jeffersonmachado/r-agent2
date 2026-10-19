#!/usr/bin/env node
'use strict';

/**
 * Governance Signing Engine — HMAC-SHA256 sobre a cadeia de governança.
 *
 * Modelo criptográfico (sem dependência circular):
 *   rootKey   = REPLAY_SIGNING_KEY || ENCRYPTION_KEY (segredo, >= 32 bytes)
 *   key       = HMAC-SHA256(rootKey, "rap-governance-v2:" + gitCommit)
 *   gov.seal  = HMAC-SHA256(key, "governance-chain:" + chainRoot + ":" + timestamp)
 *   rel.seal  = HMAC-SHA256(key, zipName + ":" + chainRoot + ":" + gitCommit + ":" + timestamp)
 *   att.seal  = HMAC-SHA256(key, "governance-attestation:" + contentHash + ":" + chainRoot)
 *
 * O hash do ZIP NÃO entra nas sigs internas — ele é computado DEPOIS do
 * empacotamento e fica exclusivamente no sidecar manifest. As sigs internas
 * ao ZIP provam a integridade da governança via chainRoot.
 *
 * Outputs primários (dentro do ZIP via dist/governance-artifacts/):
 *   dist/governance-artifacts/governance.sig
 *   dist/governance-artifacts/release.sig
 *   dist/governance-artifacts/package.manifest.sig
 *   dist/governance-artifacts/replay.sig
 *   dist/governance-artifacts/governance-attestation.json
 *   dist/governance-artifacts/governance-chain.json
 *
 * Outputs secundários (sidecar, fora do ZIP):
 *   dist/governance.sig            (cópia para compatibilidade)
 *   dist/release.sig
 *   dist/package.manifest.sig
 *   dist/governance-attestation.json
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const {
  buildChain,
  writeChain,
  certifyChain,
  verifyChain,
  sha256File,
  sha256String,
  resolveArtifact,
} = require('./governance-chain');
const { resolveSigningKey } = require('../lib/replayIntegrity');

const ROOT              = path.join(__dirname, '..');
const GOV_ARTIFACTS_DIR = path.join(ROOT, 'dist', 'governance-artifacts');

// ─── Derivação determinística de chave ────────────────────────────────────────
function deriveGovernanceKey(gitCommit, explicitKey = null) {
  const rootKey = resolveSigningKey(explicitKey);
  return crypto.createHmac('sha256', rootKey)
    .update(`rap-governance-v2:${gitCommit}`, 'utf8')
    .digest();
}

function hmacSign(key, message) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

// ─── Assinatura de artefato individual ───────────────────────────────────────
function signArtifact({ subject, hash, chainRoot, gitCommit, timestamp, extra = '', signingKey = null }) {
  const rootKey = resolveSigningKey(signingKey);
  const key     = deriveGovernanceKey(gitCommit, rootKey);
  const message = [subject, hash, chainRoot, timestamp, extra].filter(Boolean).join(':');
  const seal    = hmacSign(key, message);

  const result = {
    signatureVersion: 2,
    algorithm:    'hmac-sha256',
    keyDerivation: 'hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)',
    keyId: crypto.createHash('sha256').update(rootKey).digest('hex').slice(0, 16),
    subject,
    sha256:       hash,
    chainRoot,
    gitCommit,
    timestamp,
    seal,
    governanceLevel: 'LEVEL_4_IMMUTABLE',
    verificationNote: 'derive key with configured replay signing secret; verify HMAC-SHA256 over subject:sha256:chainRoot:timestamp[:extra]',
  };
  if (extra) result.extra = extra;
  return result;
}

// ─── Verificação de assinatura ────────────────────────────────────────────────
function verifySeal(sigObj, options = {}) {
  if (!sigObj || !sigObj.seal || !sigObj.gitCommit) return false;
  if (sigObj.signatureVersion !== 2
    || sigObj.algorithm !== 'hmac-sha256'
    || sigObj.keyDerivation !== 'hmac-sha256(replay-signing-key,rap-governance-v2:gitCommit)') {
    return false;
  }
  let rootKey;
  let key;
  try {
    rootKey = resolveSigningKey(options.signingKey);
    key = deriveGovernanceKey(sigObj.gitCommit, rootKey);
  } catch (_) {
    return false;
  }
  const actualKeyId = crypto.createHash('sha256').update(rootKey).digest('hex').slice(0, 16);
  if (!sigObj.keyId || sigObj.keyId !== actualKeyId) return false;
  const message = [sigObj.subject, sigObj.sha256, sigObj.chainRoot, sigObj.timestamp, sigObj.extra || '']
    .filter(Boolean).join(':');
  const expected = hmacSign(key, message);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(String(sigObj.seal || ''), 'hex');
  return expectedBuffer.length === actualBuffer.length
    && expectedBuffer.length > 0
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

// ─── Utilitário de leitura ────────────────────────────────────────────────────
function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writeArtifact(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// ─── PRE-SIGN (antes do empacotamento — sem hash do ZIP) ──────────────────────
/**
 * Gera todas as assinaturas e o atestado usando apenas o chainRoot.
 * Chamado ANTES de generate-zip.sh para que os artefatos sejam incluídos no ZIP.
 * O hash do ZIP não é necessário e NÃO entra nas sigs internas.
 */
function preSign(options = {}) {
  const artifact  = resolveArtifact();
  const gitCommit = artifact.manifest?.git_commit
    || options.gitCommit
    || require('child_process').execSync(
        'git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }
      ).trim();

  // Construir cadeia a partir dos arquivos de governança atuais
  const chain    = buildChain(artifact);

  const ts         = new Date().toISOString();
  const zipName    = artifact.zip;
  const chainRoot  = chain.chainRoot;

  // ── CERTIFICAÇÃO REAL (FASE 6 / 2026-10-16) ────────────────────────────────
  //
  // DEFEITO MEDIDO: `buildChain()` gravava `valid: completeChain` — "válido"
  // significava apenas "todos os arquivos existem", sem recalcular um único hash.
  // O preSign assinava a raiz SEM nunca verificar, e o atestado propagava
  // `chainValid: true` para o mundo. Resultado medido: artefato declarando
  // `valid: true` enquanto a recalculação encontrava 9 divergências, e o gate
  // `validate:self-proving` aprovando a partir desse campo.
  //
  // Agora a certificação RECALCULA. Se a cadeia não fechar, o estado medido é
  // gravado (o artefato nunca fica com aparência de válido) e a assinatura é
  // RECUSADA — não se assina uma raiz que não corresponde aos bytes.
  const certificacao = certifyChain(chain, {
    origem: 'governance/sign-governance.js:preSign',
    agora:  ts,
  });

  if (!certificacao.certificada) {
    // Grava o estado MEDIDO antes de falhar: o artefato nunca mantém aparência
    // de válido depois de um elo ser alterado.
    writeChain(chain);
    throw new Error(
      `CADEIA_NAO_CERTIFICAVEL: a recalculação encontrou ${certificacao.failures.length} divergência(s) — ` +
      `${certificacao.failures.map((f) => `${f.id}:${f.reason}`).join(', ')}. ` +
      'Estado DIVERGENTE gravado em governance/governance-chain.json; assinatura recusada.'
    );
  }

  // 1. Assinatura de governança (cadeia completa)
  const govSig = signArtifact({
    subject:    'governance-chain',
    hash:       chainRoot,
    chainRoot,
    gitCommit,
    timestamp:  ts,
    extra:      `links:${chain.chainLength}`,
  });

  // 2. Assinatura de release (ZIP name + chainRoot — sem hash do ZIP)
  const releaseSig = signArtifact({
    subject:    zipName,
    hash:       chainRoot,          // chain root é a identidade criptográfica
    chainRoot,
    gitCommit,
    timestamp:  ts,
    extra:      `pre-sign:no-zip-hash`,
  });

  // 3. Assinatura do manifesto de release (usando hash do manifesto sidecar anterior, se disponível)
  const manifestHash  = sha256File(artifact.manifestPath) || chainRoot;
  const manifestSig   = signArtifact({
    subject:    zipName.replace(/\.zip$/, '.manifest.json'),
    hash:       manifestHash,
    chainRoot,
    gitCommit,
    timestamp:  ts,
  });

  // 4. Assinatura de replay (prova das assinaturas de replay existentes)
  const proofSig    = readJsonSafe(path.join(ROOT, 'governance', 'proof-signature.json')) || {};
  const replayHash  = sha256String(JSON.stringify(proofSig));
  const replaySig   = signArtifact({
    subject:    'replay-chain',
    hash:       replayHash,
    chainRoot,
    gitCommit,
    timestamp:  ts,
    extra:      `replays:${(proofSig.subjectHashes || []).length}`,
  });

  // 5. Leitura de relatórios para o atestado
  const proofReport    = readJsonSafe(path.join(ROOT, 'governance', 'final-proof-report.json'))       || {};
  const consistencyRep = readJsonSafe(path.join(ROOT, 'governance', 'final-consistency-report.json')) || {};
  const crossReport    = readJsonSafe(path.join(ROOT, 'governance', 'cross-report-validation.json'))  || {};

  // 6. Atestado enterprise completo (sem hash do ZIP — usa chainRoot como identidade)
  const attestationContentHash = sha256String(JSON.stringify({
    zipName, chainRoot, gitCommit,
    finalDecision: proofReport.finalDecision || 'UNKNOWN',
  }));
  const attestationSeal = signArtifact({
    subject:    'governance-attestation',
    hash:       attestationContentHash,
    chainRoot,
    gitCommit,
    timestamp:  ts,
    extra:      `decision:${proofReport.finalDecision || 'UNKNOWN'}`,
  });

  const attestation = {
    generatedAt:     ts,
    schemaVersion:   '2.0.0',
    governanceLevel: 'LEVEL_4_IMMUTABLE',

    packageIdentity: {
      name:          zipName,
      // Ler sha256 do sidecar manifest quando disponível (resolve circular dependency
      // porque o sidecar manifest é criado APÓS o empacotamento, fora do ZIP)
      sha256:        artifact.manifest?.sha256 || null,
      sha256Source:  artifact.manifest?.sha256 ? 'sidecar-manifest' : 'pending-post-packaging',
      chainRoot,                                    // prova criptográfica da governança
      gitCommit,
      note:          artifact.manifest?.sha256
        ? 'sha256 read from sidecar manifest — circular dependency resolved'
        : 'sha256 will be set in sidecar manifest after packaging to avoid circular dependency',
    },

    commitProvenance: {
      gitCommit,
      gitBranch:   artifact.manifest?.git_branch  || 'main',
      generatedBy: artifact.manifest?.generated_by || 'scripts/release-package.sh',
      generatedAt: artifact.manifest?.generated_at || ts,
    },

    chainAttestation: {
      chainRoot,
      chainLength:   chain.chainLength,
      chainComplete: chain.completeChain,
      // chainValid agora é o veredito RECALCULADO (não mais "todos os arquivos
      // existem"). Ver `certifyChain()` em governance/governance-chain.js.
      chainValid:    chain.valid,
      verification:  chain.verification,
      certificationState: chain.certification ? chain.certification.state : null,
      certifiedAt:   chain.certification ? chain.certification.certifiedAt : null,
      certifiedBy:   chain.certification ? chain.certification.origem : null,
      verifiedLinks: chain.certification ? chain.certification.checkedLinks : null,
      missingLayers: chain.missingLayers,
    },

    selfContainment: {
      distArtifactsIncluded: true,
      signaturesInZip:       true,
      attestationInZip:      true,
      offlineVerifiable:     true,
      note:                  'All proof artifacts are in dist/governance-artifacts/ inside the ZIP',
    },

    operationalCoverage: {
      replayCoverage:    proofReport.replayCoverage    || null,
      prodLikeCoverage:  proofReport.prodLikeCoverage  || null,
      proofCoverage:     proofReport.proofCoverage     || null,
      proofQualityScore: proofReport.proofQualityScore || null,
      verticalCoverage:  proofReport.verticalCoverage  || null,
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
        status:           proofReport.intelligenceStability?.status || 'UNKNOWN',
        unstableDomains:  (proofReport.intelligenceStability?.unstableDomains || []).length,
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
      governance:  govSig,
      release:     releaseSig,
      manifest:    manifestSig,
      replay:      replaySig,
      attestation: attestationSeal,
    },

    // Campos de identidade canônica do pacote — propagados para auditabilidade
    boundZipName:    zipName,
    boundZipHash:    artifact.manifest?.sha256 || null,
    finalDecision:   proofReport.finalDecision || 'UNKNOWN',
    autonomousReady: proofReport.finalDecision === 'AUTONOMOUS_READY_GO'
      || (crossReport.maximumAllowedReadiness === 'autonomous-ready' && (crossReport.blockerCount || 0) === 0),

    verificationInstructions: [
      '1. Verify ZIP SHA256 against sidecar manifest: sha256sum <zip> vs manifest.sha256',
      '2. Run: node governance/governance-chain.js --verify',
      '3. Configure REPLAY_SIGNING_KEY/ENCRYPTION_KEY and verify HMAC-SHA256 signatures',
      '4. Run: bash scripts/verify-enterprise-governance.sh (offline, no external deps)',
      '5. All proof artifacts are in dist/governance-artifacts/ inside the ZIP',
    ],
  };

  // Escrever em dist/governance-artifacts/ (para inclusão no ZIP)
  fs.mkdirSync(GOV_ARTIFACTS_DIR, { recursive: true });
  writeArtifact(path.join(GOV_ARTIFACTS_DIR, 'governance.sig'),             govSig);
  writeArtifact(path.join(GOV_ARTIFACTS_DIR, 'release.sig'),                releaseSig);
  writeArtifact(path.join(GOV_ARTIFACTS_DIR, 'package.manifest.sig'),       manifestSig);
  writeArtifact(path.join(GOV_ARTIFACTS_DIR, 'replay.sig'),                 replaySig);
  writeArtifact(path.join(GOV_ARTIFACTS_DIR, 'governance-attestation.json'), attestation);

  // A cadeia é gravada por ÚLTIMO (junto com os demais artefatos): toda a parte
  // que pode falhar — derivação de chave, HMACs, atestação — já rodou. Antes, a
  // cadeia era gravada no início e uma falha de chave deixava o par
  // cadeia↔atestado divergente (medido: REPLAY_SIGNING_KEY_REQUIRED).
  writeChain(chain);

  // Copiar governance-chain.json para dentro de governance-artifacts/
  const chainSrc = path.join(ROOT, 'governance', 'governance-chain.json');
  if (fs.existsSync(chainSrc)) {
    fs.copyFileSync(chainSrc, path.join(GOV_ARTIFACTS_DIR, 'governance-chain.json'));
  }

  // Persistir o seal HMAC em governance/ (diretório de código-fonte — não gerenciado
  // por two-pass-release.sh, não apagado após release). Esta é a localização canonical
  // para verificação offline pelo final-governance-engine.js.
  writeArtifact(path.join(ROOT, 'governance', 'governance.sig'), govSig);

  // Remover cópias legadas da raiz de dist/ (migração de behavior anterior).
  // dist/governance-artifacts/ NÃO é removido aqui — o zip:release precisa incluí-lo
  // no ZIP; a limpeza do staging é responsabilidade do release-package.sh.
  const distDir = path.join(ROOT, 'dist');
  const legacyRootFiles = ['governance.sig', 'release.sig', 'package.manifest.sig', 'replay.sig', 'governance-attestation.json'];
  for (const f of legacyRootFiles) {
    const legacyPath = path.join(distDir, f);
    try { if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath); } catch (_) {}
  }

  return {
    chain,
    attestation,
    signatures: { governance: govSig, release: releaseSig, manifest: manifestSig, replay: replaySig },
    outputs: [
      'dist/governance-artifacts/governance.sig',
      'dist/governance-artifacts/release.sig',
      'dist/governance-artifacts/package.manifest.sig',
      'dist/governance-artifacts/replay.sig',
      'dist/governance-artifacts/governance-attestation.json',
      'dist/governance-artifacts/governance-chain.json',
      'governance/governance.sig',
      'governance/governance-chain.json',
    ],
    presigned: true,
  };
}

// signAll mantido como alias de preSign para compatibilidade
const signAll = preSign;

module.exports = { signAll, preSign, signArtifact, verifySeal, deriveGovernanceKey };

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const verify = process.argv.includes('--verify');

  if (verify) {
    const distDir    = path.join(ROOT, 'dist');
    const sigFiles   = ['release.sig', 'governance.sig', 'package.manifest.sig', 'replay.sig'];
    let   allValid   = true;

    // Verificar em dist/ e em dist/governance-artifacts/
    const searchDirs = [distDir, GOV_ARTIFACTS_DIR];
    for (const sigName of sigFiles) {
      let found = false;
      for (const dir of searchDirs) {
        const sigPath = path.join(dir, sigName);
        if (!fs.existsSync(sigPath)) continue;
        const sig   = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
        const valid = verifySeal(sig);
        // eslint-disable-next-line no-console
        console.log(`[sign-governance] ${path.relative(ROOT, sigPath)}: ${valid ? 'VÁLIDA ✓' : 'INVÁLIDA ✗'}`);
        if (!valid) allValid = false;
        found = true;
        break;
      }
      if (!found) {
        // eslint-disable-next-line no-console
        console.error(`[sign-governance] ausente: ${sigName}`);
        allValid = false;
      }
    }

    // ── A verificação offline precisa verificar a CADEIA, não só os HMACs ──────
    // DEFEITO MEDIDO (2026-10-16): `--verify` conferia apenas as assinaturas HMAC.
    // Uma assinatura íntegra sobre uma raiz que NÃO corresponde mais aos bytes dos
    // artefatos passava como "governança verificada" — a assinatura é do HASH da
    // raiz, não do conteúdo atual dos elos. Agora a cadeia é RECALCULADA.
    const chainCandidates = [
      path.join(GOV_ARTIFACTS_DIR, 'governance-chain.json'),
      path.join(ROOT, 'governance', 'governance-chain.json'),
    ];
    let chainChecked = false;
    for (const chainPath of chainCandidates) {
      if (!fs.existsSync(chainPath)) continue;
      const stored = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
      const recalc = verifyChain(stored);
      // eslint-disable-next-line no-console
      console.log(
        `[sign-governance] ${path.relative(ROOT, chainPath)}: ` +
        `${recalc.valid ? 'CADEIA ÍNTEGRA ✓' : `CADEIA DIVERGENTE ✗ (${recalc.failures.length})`}`
      );
      if (!recalc.valid) {
        recalc.failures.slice(0, 10).forEach((f) => {
          // eslint-disable-next-line no-console
          console.error(`[sign-governance]   ${f.id} — ${f.reason}`);
        });
        allValid = false;
      }
      chainChecked = true;
      break;
    }
    if (!chainChecked) {
      // eslint-disable-next-line no-console
      console.error('[sign-governance] ausente: governance-chain.json (nada a verificar)');
      allValid = false;
    }

    process.exit(allValid ? 0 : 1);
  }

  let result;
  try {
    result = preSign();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[sign-governance] RECUSADO: ${error.message}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`[sign-governance] pre-signed: ${result.outputs.length} artifacts`);
  // eslint-disable-next-line no-console
  console.log(`[sign-governance] chainRoot=${result.chain.chainRoot.slice(0, 16)}… decision=${result.attestation.finalDecision}`);
  process.exit(result.chain.valid ? 0 : 1);
}
