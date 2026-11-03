#!/usr/bin/env node
'use strict';

/**
 * Replay Integrity Engine — cadeia de integridade de replays.
 *
 * Verifica que cada artefato de replay:
 *   - possui replayHash
 *   - possui parentReplayHash (ou é genesis)
 *   - a assinatura de governança é válida
 *   - não houve mutação ou remoção de replays
 *   - não há artefatos obsoletos
 *
 * Outputs:
 *   governance/replay-integrity-report.json
 *   (o fluxo de release copia para dist/governance-artifacts/ ao empacotar)
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { sha256File, sha256String, resolveArtifact } = require('./governance-chain');
const {
  validateQaWavesEnterpriseGovernance,
} = require('../tools/system/lib/qa-waves-enterprise-governance-bridge');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'replay-integrity-report.json');
const GOV_ARTS    = path.join(ROOT, 'dist', 'governance-artifacts');
const GENESIS_HASH = '0'.repeat(64);

function isHmacSignature(value) {
  return /^hmac-sha256:[a-f0-9]{64}$/i.test(String(value || ''));
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

// ─── Fontes de replay ─────────────────────────────────────────────────────────
function collectReplaySources() {
  const sources = [];

  // proof-signature.json (fonte primária)
  const proofSig = readJsonSafe(path.join(ROOT, 'governance', 'proof-signature.json'));
  if (proofSig?.subjectHashes) {
    for (const r of proofSig.subjectHashes) {
      sources.push({
        source:     'proof-signature.json',
        journeyId:  r.journeyId,
        replayHash: r.replayHash || r.replayChecksum?.replace('sha256:', ''),
        signature:  proofSig.signature,
        governanceSignature: r.governanceSignature,
        timestamp:  proofSig.generatedAt,
      });
    }
  }

  // qa/enterprise/omnichannel-unified-replay.json
  const omni = readJsonSafe(path.join(ROOT, 'qa', 'enterprise', 'omnichannel-unified-replay.json'));
  if (omni?.replays || omni?.unifiedReplay) {
    const replays = omni.replays || omni.unifiedReplay || [];
    for (const r of (Array.isArray(replays) ? replays : [replays])) {
      if (r?.journeyId || r?.replayId) {
        sources.push({
          source:     'omnichannel-unified-replay.json',
          journeyId:  r.journeyId || r.replayId,
          replayHash: r.replayHash || sha256String(JSON.stringify(r)),
          timestamp:  r.completedAt || r.timestamp || null,
        });
      }
    }
  }

  // final-proof-report.json replayCoverage
  const proof = readJsonSafe(path.join(ROOT, 'governance', 'final-proof-report.json'));
  if (proof?.replayCoverage?.supportedJourneys) {
    for (const jid of proof.replayCoverage.supportedJourneys) {
      if (!sources.find((s) => s.journeyId === jid)) {
        sources.push({
          source:    'final-proof-report.json',
          journeyId: jid,
          replayHash: null,  // referência declarativa sem hash físico
          declared:  true,
        });
      }
    }
  }

  return sources;
}

// ─── Construção da cadeia de replays ──────────────────────────────────────────
function buildReplayChain(sources) {
  const chain = [];
  let prevHash = GENESIS_HASH;

  for (const source of sources) {
    const hash  = source.replayHash || sha256String(JSON.stringify(source));
    const link  = {
      index:            chain.length,
      journeyId:        source.journeyId,
      source:           source.source,
      replayHash:       hash,
      parentReplayHash: prevHash,
      cumulativeHash:   sha256String(`${prevHash}:${hash}`),
      evidenceHash:     sha256String(JSON.stringify(source)),
      governanceHash:   source.governanceSignature || null,
      timestamp:        source.timestamp || new Date().toISOString(),
      declared:         source.declared || false,
      hasPhysicalHash:  !!source.replayHash,
    };
    chain.push(link);
    prevHash = hash;
  }

  return chain;
}

// ─── Verificações de integridade ──────────────────────────────────────────────
function checkReplayChain(chain, proofSigAudit) {
  const issues = [];

  // 1. Verificar hashes físicos
  const withoutHash = chain.filter((l) => !l.hasPhysicalHash && !l.declared);
  if (withoutHash.length > 0) {
    issues.push({
      type:     'missing_replay_hash',
      severity: 'MEDIUM',
      journeys: withoutHash.map((l) => l.journeyId),
    });
  }

  // 2. A auditoria precisa existir e aceitar somente HMAC com chave secreta.
  // Relatórios legados usavam gov-sha256 (hash público) e não constituem
  // assinatura; ausência da auditoria nunca pode virar PASS por omissão.
  const auditedSignatures = Array.isArray(proofSigAudit?.signatures)
    ? proofSigAudit.signatures
    : [];
  if (proofSigAudit?.valid !== true || auditedSignatures.length === 0) {
    issues.push({
      type: 'replay_signature_audit_missing_or_invalid',
      severity: 'CRITICAL',
    });
  }
  const invalidSigs = auditedSignatures.filter((signature) => (
    signature?.valid !== true
    || !isHmacSignature(signature?.actual)
    || !isHmacSignature(signature?.expected)
  ));
  if (invalidSigs.length > 0) {
    issues.push({
      type: 'invalid_governance_signatures',
      severity: 'CRITICAL',
      journeys: invalidSigs.map((signature) => signature.journeyId),
    });
  }

  // 3. Verificar algoritmo individual e coerência completa da cadeia.
  for (let i = 0; i < chain.length; i++) {
    const expectedParent = i === 0 ? GENESIS_HASH : chain[i - 1].replayHash;
    const expectedCumulative = sha256String(`${expectedParent}:${chain[i].replayHash}`);
    if (!isHmacSignature(chain[i].governanceHash)) {
      issues.push({
        type: 'unsupported_replay_governance_signature',
        severity: 'CRITICAL',
        index: i,
        journeyId: chain[i].journeyId,
      });
    }
    if (chain[i].parentReplayHash !== expectedParent) {
      issues.push({
        type:     'chain_break',
        severity: 'CRITICAL',
        index:    i,
        journeyId: chain[i].journeyId,
      });
    }
    if (chain[i].cumulativeHash !== expectedCumulative) {
      issues.push({
        type: 'cumulative_hash_mismatch',
        severity: 'CRITICAL',
        index: i,
        journeyId: chain[i].journeyId,
      });
    }
  }

  return issues;
}

function checkProofBinding(proofSig, enterpriseReport, enterpriseValidation) {
  const issues = [];
  if (!enterpriseReport || enterpriseValidation?.valid !== true) {
    issues.push({
      type: 'enterprise_replay_governance_invalid',
      severity: 'CRITICAL',
      reasons: enterpriseValidation?.reasons || ['enterprise_report_missing'],
    });
    return issues;
  }

  if (proofSig?.sourceArtifact !== 'qa/qa-waves-enterprise-governance.json') {
    issues.push({ type: 'proof_source_invalid', severity: 'CRITICAL' });
  }
  if (!proofSig?.reportHash || proofSig.reportHash !== enterpriseReport.reportHash) {
    issues.push({ type: 'proof_report_hash_mismatch', severity: 'CRITICAL' });
  }
  if (!proofSig?.signature || proofSig.signature !== enterpriseReport.enterpriseGovernanceSignature) {
    issues.push({ type: 'proof_enterprise_signature_mismatch', severity: 'CRITICAL' });
  }

  const expectedArtifacts = new Map(
    (enterpriseReport.replayArtifacts || []).map((artifact) => [artifact.journeyId, artifact])
  );
  const subjects = Array.isArray(proofSig?.subjectHashes) ? proofSig.subjectHashes : [];
  if (subjects.length === 0 || subjects.length !== expectedArtifacts.size) {
    issues.push({ type: 'proof_subject_count_mismatch', severity: 'CRITICAL' });
  }
  for (const subject of subjects) {
    const expected = expectedArtifacts.get(subject.journeyId);
    if (!expected
      || subject.replayHash !== expected.replayHash
      || subject.replayChecksum !== expected.replayChecksum
      || subject.governanceSignature !== expected.governanceSignature) {
      issues.push({
        type: 'proof_subject_binding_mismatch',
        severity: 'CRITICAL',
        journeyId: subject.journeyId || null,
      });
    }
  }
  return issues;
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function generateReplayIntegrityReport() {
  let artifact;
  try { artifact = resolveArtifact(); } catch (e) {
    return { generatedAt: new Date().toISOString(), pass: false, error: e.message };
  }

  const proofSig     = readJsonSafe(path.join(ROOT, 'governance', 'proof-signature.json')) || {};
  const enterpriseReport = readJsonSafe(path.join(ROOT, 'qa', 'qa-waves-enterprise-governance.json'));
  let enterpriseValidation = { valid: false, reasons: ['enterprise_report_missing'] };
  if (enterpriseReport) {
    enterpriseValidation = validateQaWavesEnterpriseGovernance(enterpriseReport);
  }
  const sources      = collectReplaySources();
  const chain        = buildReplayChain(sources);
  const signatureAudit = proofSig.signatureAudit || proofSig.audit || null;
  const chainIssues = checkReplayChain(chain, signatureAudit);
  const proofBindingIssues = checkProofBinding(proofSig, enterpriseReport, enterpriseValidation);
  const issues       = chainIssues.concat(proofBindingIssues);
  const criticals    = issues.filter((i) => i.severity === 'CRITICAL');
  const replayRoot   = chain.length > 0 ? chain[chain.length - 1].cumulativeHash : GENESIS_HASH;

  // Verificar que o replay.sig cobre este root. Layout legado (mid-pipeline,
  // pré-normalização): HMAC seal v2 em dist/governance-artifacts/ ou dist/ raiz.
  // Layout normalizado (two-pass, pós-release): manifest-style em dist/signatures/,
  // verificado deterministicamente contra o sha256 do payload — mesma regra de
  // dist/verifier/verify-enterprise-governance-v2.sh.
  let replaySigValid = false;
  const replaySigPath = path.join(GOV_ARTS, 'replay.sig');
  const replaySigFallback = path.join(ROOT, 'dist', 'replay.sig');
  const replaySigNormalized = path.join(ROOT, 'dist', 'signatures', 'replay.sig');
  const { verifySeal } = require('./sign-governance');
  for (const p of [replaySigPath, replaySigFallback]) {
    if (fs.existsSync(p)) {
      try {
        const sig = JSON.parse(fs.readFileSync(p, 'utf8'));
        replaySigValid = verifySeal(sig);
      } catch (_) {}
      break;
    }
  }
  if (!replaySigValid && fs.existsSync(replaySigNormalized)) {
    try {
      const sig = JSON.parse(fs.readFileSync(replaySigNormalized, 'utf8'));
      // O sig é vinculado ao payload saneado (dist/release/*.payload.zip),
      // não ao envelope resolvido por resolveArtifact.
      const payloadRef = sig.payloadRef || sig.artifact;
      const payloadPath = path.join(ROOT, 'dist', 'release', path.basename(String(payloadRef || '')));
      const payloadSha = fs.existsSync(payloadPath) ? sha256File(payloadPath) : sha256File(artifact.zipPath);
      const expected = sha256String(`${payloadSha}:replay.sig:${sig.releaseId || ''}`);
      replaySigValid = sig.placeholder === false
        && sig.transitional === false
        && (sig.status === 'valid' || sig.status === 'final')
        && Boolean(sig.artifact)
        && sig.algorithm === 'sha256'
        && (sig.payloadSha256 === payloadSha || sig.artifactSha256 === payloadSha)
        && sig.signature === expected;
    } catch (_) {}
  }

  const pass = criticals.length === 0 && replaySigValid;
  const auditedSignatures = Array.isArray(signatureAudit?.signatures) ? signatureAudit.signatures : [];
  const signatureAuditValid = signatureAudit?.valid === true
    && auditedSignatures.length > 0
    && auditedSignatures.every((signature) => (
      signature?.valid === true
      && isHmacSignature(signature?.actual)
      && isHmacSignature(signature?.expected)
    ));
  const signatureAlgorithmsValid = chain.length > 0
    && auditedSignatures.length > 0
    && chain.every((item) => isHmacSignature(item.governanceHash))
    && auditedSignatures.every((signature) => (
      isHmacSignature(signature?.actual) && isHmacSignature(signature?.expected)
    ));
  const proofBindingValid = proofBindingIssues.length === 0;

  const report = {
    generatedAt:     new Date().toISOString(),
    artifact:        artifact.zip,
    pass,
    totalReplays:    chain.length,
    physicalHashes:  chain.filter((l) => l.hasPhysicalHash).length,
    declaredOnly:    chain.filter((l) => l.declared).length,
    replayRoot,
    replaySigValid,
    enterpriseGovernanceValid: enterpriseValidation.valid === true,
    enterpriseGovernanceReasons: enterpriseValidation.reasons || [],
    proofBindingValid,
    signatureAuditValid,
    signatureAlgorithmsValid,
    sourceGeneratedAt: proofSig.generatedAt || null,
    issues,
    criticalIssues:  criticals.length,
    chain,
    governanceSignature: proofSig.signature || null,
    summary: pass
      ? `Todos os ${chain.length} replays têm integridade verificada.`
      : `${issues.length} problema(s) de integridade detectado(s) nos replays.`,
  };

  // Escrever em governance/
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  // NOTA: não copiar para dist/governance-artifacts/ — esse diretório é
  // populado exclusivamente pelo fluxo de release (release-package.sh /
  // two-pass-release.sh) e validate:dist falha se houver resíduo fora dele.

  return report;
}

/**
 * Resume o relatório para o CLI. O engine retorna dois shapes distintos:
 * o completo (com `issues`/`totalReplays`) e o de erro
 * (`{ generatedAt, pass:false, error }`, quando o artefato de release não
 * resolve). O resumo precisa cobrir ambos — assumir `issues` presente
 * derrubava o entrypoint com TypeError em vez de falhar fechado.
 */
function formatCliSummary(report) {
  const r = report || { pass: false, error: 'report_unavailable' };
  if (Array.isArray(r.issues)) {
    return `[replay-integrity] pass=${r.pass} replays=${r.totalReplays} issues=${r.issues.length}`;
  }
  return `[replay-integrity] pass=${r.pass} error=${r.error || 'unknown'}`;
}

module.exports = {
  formatCliSummary,
  generateReplayIntegrityReport,
  buildReplayChain,
  checkProofBinding,
  checkReplayChain,
  collectReplaySources,
  isHmacSignature,
};

if (require.main === module) {
  const report = generateReplayIntegrityReport();
  // eslint-disable-next-line no-console
  console.log(formatCliSummary(report));
  process.exit(report && report.pass === true ? 0 : 1);
}
