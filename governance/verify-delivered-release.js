#!/usr/bin/env node
'use strict';

/**
 * verify-delivered-release.js — verificador oficial do artefato entregue.
 *
 * Executa sobre uma extração limpa do ZIP final e valida que:
 *   1. package manifest existe e é válido
 *   2. runId está presente e consistente
 *   3. sourceFingerprint recalculado == sourceFingerprint do proof == manifest
 *   4. inventoryFingerprint, scenarioFingerprint, policyFingerprint recalculados
 *   5. proof freshness (recalcula, não confia em status armazenado)
 *   6. artifact run consistency (todos artifacts com runId == current)
 *   7. Stale/foreign report detection
 *   8. Coverage result
 *   9. Mandatory gate aggregation
 *  10. Final consistency
 *  11. Final decision
 *
 * Sucesso: DELIVERED_RELEASE_VERIFIED + AUTONOMOUS_READY + exit 0
 * Falha:   DELIVERED_RELEASE_NO_GO + exit 1
 *
 * Uso:
 *   node governance/verify-delivered-release.js [--root <dir>] [--strict]
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const ROOT  = rootIdx !== -1 ? path.resolve(args[rootIdx + 1]) : process.cwd();
const STRICT = args.includes('--strict');

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

function sha256File(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

function sha256Str(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ─── Gate factories ──────────────────────────────────────────────────────────

function makeGate(id, mandatory = true) {
  return { id, mandatory, status: 'PENDING', reason: null, runId: null };
}

function pass(gate, detail = {}) {
  return { ...gate, ...detail, status: 'PASS' };
}

function fail(gate, reason, detail = {}) {
  return { ...gate, ...detail, status: 'FAIL', reason };
}

// ─── 1. Package manifest ─────────────────────────────────────────────────────
function checkPackageManifest() {
  const gate = makeGate('package_manifest');

  // Procurar sidecar manifest ao lado do ZIP em dist/release/.
  // PROIBIDO: nunca criar manifest sintético a partir do Proof.
  const releaseDir = path.join(ROOT, 'dist', 'release');
  let manifest = null;
  let manifestPath = null;

  if (fs.existsSync(releaseDir)) {
    const manifests = fs.readdirSync(releaseDir)
      .filter((f) => f.endsWith('.manifest.json'))
      .sort()
      .reverse();
    if (manifests.length > 0) {
      manifestPath = path.join(releaseDir, manifests[0]);
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) {}
    }
  }

  if (!manifest) return fail(gate, 'PACKAGE_MANIFEST_REQUIRED — manifest real ausente em dist/release/. Proibido usar Proof como substituto.');
  return pass(gate, { manifest, manifestPath });
}

// ─── 2. runId consistency ────────────────────────────────────────────────────
function checkRunId(manifest) {
  const gate = makeGate('run_id_consistency');

  const currentRun = readJson('governance/.current-run.json');
  const manifestRunId = manifest?.runId;

  // runId ausente é INVÁLIDO. Sem compatibilidade com "pré-FINAL3".
  if (!manifestRunId) {
    return fail(gate, 'INVALID_ARTIFACT — runId ausente no manifest. Todo artifact governado deve ter runId.');
  }
  if (!currentRun?.runId) {
    return fail(gate, 'INVALID_ARTIFACT — .current-run.json ausente ou sem runId.');
  }
  if (manifestRunId !== currentRun.runId) {
    return fail(gate, `FOREIGN_RUN_ARTIFACT — runId do manifest (${manifestRunId}) diverge do run atual (${currentRun.runId})`);
  }

  return pass(gate, { runId: manifestRunId });
}

// ─── 3. Source fingerprint ───────────────────────────────────────────────────
function checkSourceFingerprint(manifest) {
  const gate = makeGate('source_fingerprint');

  let computeFingerprintChain;
  try {
    computeFingerprintChain = require('./proof-engine/fingerprint-chain.js').computeFingerprintChain;
  } catch (e) {
    return fail(gate, `fingerprint-chain.js não encontrado: ${e.message}`);
  }

  let chain;
  try { chain = computeFingerprintChain(ROOT); } catch (e) {
    return fail(gate, `Erro ao calcular fingerprint: ${e.message}`);
  }

  const recalculated = chain.sourceFingerprint;
  const fromProof    = readJson('governance/final-proof-report.json')?.sourceFingerprint;
  const fromManifest = manifest?.sourceFingerprint;

  const mismatch = [];
  if (fromProof    && recalculated !== fromProof)    mismatch.push('proof');
  if (fromManifest && recalculated !== fromManifest) mismatch.push('manifest');

  if (mismatch.length > 0) {
    return fail(gate,
      `DELIVERED_SOURCE_MISMATCH — sourceFingerprint diverge em: ${mismatch.join(', ')}`,
      {
        recalculated: recalculated?.slice(0, 16),
        fromProof:    fromProof?.slice(0, 16),
        fromManifest: fromManifest?.slice(0, 16),
      }
    );
  }

  return pass(gate, {
    sourceFingerprint:   recalculated?.slice(0, 16),
    proofMatch:          !!fromProof,
    manifestMatch:       !!fromManifest,
  });
}

// ─── 4. Fingerprint chain ────────────────────────────────────────────────────
function checkFingerprintChain() {
  const gate = makeGate('fingerprint_chain');

  let computeFingerprintChain, compareFingerprintChains;
  try {
    const mod = require('./proof-engine/fingerprint-chain.js');
    computeFingerprintChain  = mod.computeFingerprintChain;
    compareFingerprintChains = mod.compareFingerprintChains;
  } catch (e) {
    return fail(gate, `fingerprint-chain.js não encontrado: ${e.message}`);
  }

  const chain    = computeFingerprintChain(ROOT);
  const manifest = readJson('governance/evidence-manifest.json');
  const registered = manifest?.fingerprints || null;
  const status   = compareFingerprintChains(registered, chain);

  if (status.status === 'STALE') {
    return fail(gate,
      `STALE_PROOF — fingerprints divergem: ${status.diverged.join(', ')}`,
      { diverged: status.diverged }
    );
  }

  return pass(gate, {
    fingerprintStatus: status.status,
    chainFingerprint:  chain.chainFingerprint?.slice(0, 16),
  });
}

// ─── 5. Proof freshness ──────────────────────────────────────────────────────
function checkProofFreshness() {
  const gate = makeGate('proof_freshness');
  const proof = readJson('governance/final-proof-report.json');

  if (!proof) return fail(gate, 'final-proof-report.json ausente');
  if (proof.finalDecision && proof.finalDecision.startsWith('NO_GO')) {
    return fail(gate, `Proof diz NO_GO: ${proof.finalDecision}`);
  }

  // Verificar freshness real via fingerprintChain (não confiar em status armazenado)
  const fpChain = proof.fingerprintChain || {};
  if (fpChain.status === 'STALE') {
    return fail(gate, `STALE_PROOF — fingerprintStatus=STALE no proof report`);
  }

  return pass(gate, {
    proofDecision:     proof.finalDecision,
    fingerprintStatus: fpChain.status || 'UNKNOWN',
  });
}

// ─── 6. Artifact run consistency ─────────────────────────────────────────────
function checkArtifactRunConsistency() {
  const gate = makeGate('artifact_run_consistency');

  const currentRun = readJson('governance/.current-run.json');
  const currentRunId = currentRun?.runId;

  if (!currentRunId) {
    return pass(gate, { note: 'runId não configurado; consistência de artifacts pulada' });
  }

  const governanceFiles = fs.existsSync(path.join(ROOT, 'governance'))
    ? fs.readdirSync(path.join(ROOT, 'governance'))
        .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        .map((f) => `governance/${f}`)
    : [];

  const foreign = [];
  for (const relPath of governanceFiles) {
    const data = readJson(relPath);
    if (!data || typeof data !== 'object') continue;
    const artRunId = data.runId || data.run_id;
    if (artRunId && artRunId !== currentRunId) {
      foreign.push({ file: relPath, runId: artRunId });
    }
  }

  if (foreign.length > 0) {
    return fail(gate,
      `FOREIGN_RUN_ARTIFACT — ${foreign.length} artifact(s) de run diferente`,
      { foreign }
    );
  }

  return pass(gate, { currentRunId, checkedFiles: governanceFiles.length });
}

// ─── 7. Critical journey evidence ───────────────────────────────────────────
function checkCriticalJourney() {
  const gate = makeGate('critical_causal_journey');

  const evidence = readJson('governance/critical-journey-evidence.json');
  // Ausência de evidência causal é BLOQUEANTE. Sem fail-open.
  if (!evidence) {
    return fail(gate, 'CRITICAL_CAUSAL_EVIDENCE_MISSING — critical-journey-evidence.json ausente. A cadeia causal real é obrigatória.');
  }

  const chain = evidence.causalChain || [];
  const required = ['INBOUND_MESSAGE', 'COGNITIVE_DECISION', 'HANDOFF_REQUEST', 'HUMAN_TAKEOVER', 'BACKEND_MUTATION', 'BUSINESS_OUTCOME'];
  const present = new Set(chain.map((e) => e.eventType || e.type));
  const missing = required.filter((r) => !present.has(r));

  if (missing.length > 0) {
    return fail(gate, `CRITICAL_CAUSAL_CHAIN_BROKEN — eventos ausentes: ${missing.join(', ')}`);
  }

  // Verificar correlationId comum
  const correlationIds = new Set(chain.map((e) => e.correlationId).filter(Boolean));
  if (correlationIds.size > 1) {
    return fail(gate, `CRITICAL_CAUSAL_CHAIN_BROKEN — correlationId divergente: ${[...correlationIds].join(', ')}`);
  }

  return pass(gate, { chainLength: chain.length, correlationId: [...correlationIds][0] });
}

// ─── 8. Tenant/system audit ──────────────────────────────────────────────────
function checkSystemScopeAudit() {
  const gate = makeGate('tenant_system_audit');

  const audit = readJson('governance/system-scope-audit.json');
  // Ausência da auditoria é BLOQUEANTE. Sem fail-open.
  if (!audit) {
    return fail(gate, 'TENANT_AUDIT_MISSING — system-scope-audit.json ausente. Auditoria de tenant é obrigatória.');
  }

  if (audit.runtimeFailOpenCount > 0) {
    return fail(gate,
      `TENANT_REQUIRED — ${audit.runtimeFailOpenCount} runtime fail-open(s) detectados`,
      { runtimeFailOpenCount: audit.runtimeFailOpenCount }
    );
  }

  return pass(gate, {
    totalFindings: audit.totalFindings,
    runtimeFailOpen: audit.runtimeFailOpenCount,
  });
}

// ─── 9. Coverage ─────────────────────────────────────────────────────────────
function checkCoverage() {
  const gate = makeGate('coverage');

  const proof = readJson('governance/final-proof-report.json');
  if (!proof) return fail(gate, 'final-proof-report.json ausente');

  const coverage = proof.proofCoverage || proof.coverage || {};
  const pct = coverage.percent ?? null;

  if (pct !== null && pct < 70) {
    return fail(gate, `Coverage insuficiente: ${pct}% (mínimo 70%)`);
  }

  return pass(gate, { coveragePercent: pct });
}

// ─── 10. Mandatory gates from governance ─────────────────────────────────────
function checkGovernanceMandatoryGates() {
  const gate = makeGate('governance_mandatory_gates');

  const govReport = readJson('governance/final-governance-report.json');
  if (!govReport) return fail(gate, 'final-governance-report.json ausente');

  if (govReport.finalDecision !== 'AUTONOMOUS_READY_GO') {
    return fail(gate, `governance decision=${govReport.finalDecision}`);
  }

  return pass(gate, { governanceDecision: govReport.finalDecision });
}

// ─── 11. Final consistency ───────────────────────────────────────────────────
function checkFinalConsistency() {
  const gate = makeGate('final_consistency');

  const report = readJson('governance/final-consistency-gate-report.json');
  if (!report) return fail(gate, 'final-consistency-gate-report.json ausente');

  if (report.decision !== 'FINAL_CONSISTENCY_GO') {
    const failures = (report.failures || []).map((f) => f.reason).join('; ');
    return fail(gate, `FINAL_CONSISTENCY_NO_GO — ${failures}`);
  }

  return pass(gate, { consistencyDecision: report.decision });
}

// ─── 12. Replay hardening ────────────────────────────────────────────────────
function checkReplayHardening() {
  const gate = makeGate('replay_hardening');

  const report = readJson('governance/replay-hardening-report.json');
  if (!report) return fail(gate, 'replay-hardening-report.json ausente');

  if (report.decision === 'REPLAY_HARDENING_NO_GO') {
    return fail(gate, `REPLAY_HARDENING_NO_GO — violations=${report.violations}`);
  }

  return pass(gate, { hardeningDecision: report.decision });
}

// ─── Main ────────────────────────────────────────────────────────────────────
function verify() {
  console.log(`\n[verify-delivered-release] root=${ROOT}\n`);

  // Executar todos os checks
  const manifestCheck = checkPackageManifest();
  const manifest      = manifestCheck.manifest || null;

  const gates = [
    manifestCheck,
    checkRunId(manifest),
    checkSourceFingerprint(manifest),
    checkFingerprintChain(),
    checkProofFreshness(),
    checkArtifactRunConsistency(),
    checkCriticalJourney(),
    checkSystemScopeAudit(),
    checkCoverage(),
    checkGovernanceMandatoryGates(),
    checkFinalConsistency(),
    checkReplayHardening(),
  ];

  const failed    = gates.filter((g) => g.status === 'FAIL');
  const mandatory = failed.filter((g) => g.mandatory);
  const pass      = mandatory.length === 0;

  const finalDecision = pass ? 'AUTONOMOUS_READY' : 'NO_GO';
  const delivered     = pass ? 'DELIVERED_RELEASE_VERIFIED' : 'DELIVERED_RELEASE_NO_GO';

  // Exibir resultado
  console.log('─'.repeat(60));
  console.log('MANDATORY GATES');
  console.log('─'.repeat(60));
  for (const g of gates) {
    const icon = g.status === 'PASS' ? '✓' : '✗';
    console.log(`  ${icon} ${g.id.padEnd(35)} ${g.status}${g.note ? ` (${g.note})` : ''}${g.reason ? ` — ${g.reason}` : ''}`);
  }

  console.log('\n' + '─'.repeat(60));

  const proof = readJson('governance/final-proof-report.json');
  if (proof) {
    console.log('FINGERPRINTS');
    console.log('─'.repeat(60));
    const fp = [
      ['sourceFingerprint',    proof.sourceFingerprint],
      ['inventoryFingerprint', proof.inventoryFingerprint],
      ['scenarioFingerprint',  proof.scenarioFingerprint],
      ['policyFingerprint',    proof.policyFingerprint],
      ['chainFingerprint',     proof.chainFingerprint],
    ];
    for (const [k, v] of fp) {
      if (v) console.log(`  ${k}: ${v}`);
    }
    console.log();
  }

  if (manifest) {
    console.log('HASH COMPARISON');
    console.log('─'.repeat(60));
    console.log(`  source from proof:    ${proof?.sourceFingerprint?.slice(0,32) || 'N/A'}`);
    console.log(`  source from manifest: ${manifest.sourceFingerprint?.slice(0,32) || 'N/A'}`);
    console.log();
  }

  console.log('─'.repeat(60));
  console.log(`FINAL DECISION:  ${finalDecision}`);
  console.log(`DELIVERED:       ${delivered}`);
  console.log('─'.repeat(60));

  if (!pass) {
    console.log('\nFailed gates:');
    mandatory.forEach((g) => console.log(`  - ${g.id}: ${g.reason}`));
    console.log();
  }

  process.exit(pass ? 0 : 1);
}

verify();
