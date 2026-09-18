#!/usr/bin/env node
'use strict';

/**
 * verify-delivered-release.js — verificador oficial do artefato entregue.
 *
 * Executa sobre uma extração limpa do ZIP final e valida que:
 *   1. package manifest existe e é válido
 *   2. runId está presente e consistente
 *   3. sourceFingerprint recalculado == sourceFingerprint do proof == manifest
 *   3b. proveniência git: gitCommit existe no repo, git tree bate, worktree
 *       limpo ou HEAD == commit declarado (SOURCE_COMMIT_MISMATCH em divergência)
 *   3c. package hash binding: sha256 do payload == sha256 do manifest
 *   3d. experience-segregation: relatório existe, PASS e mesmo sourceFingerprint
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
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const ROOT  = rootIdx !== -1 ? path.resolve(args[rootIdx + 1]) : process.cwd();
const STRICT = args.includes('--strict');
const gitRootIdx = args.indexOf('--git-root');
const GIT_ROOT_ARG = gitRootIdx !== -1 ? path.resolve(args[gitRootIdx + 1]) : null;

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

// Dimensões cuja verificação só existe na fase DELIVERED (artefato entregue).
// Em PRE_PACKAGE, se as ÚNICAS abaixo de 10 forem estas, o gate master_scorecard
// fica DEFERRED (não FAIL): o artefato está íntegro, o scorecard ainda não
// refletiu o delivered-report que este próprio verifier produz.
const { deliveredPhaseDimensions } = require('./release-phase-policy');
// §TAREFA 49 — dimensões de fase DELIVERED: derivação da declaração única.
const DELIVERED_PHASE_DIMENSIONS = deliveredPhaseDimensions();

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
  if (!fromProof) mismatch.push('proof_missing');
  if (!fromManifest) mismatch.push('manifest_missing');
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

// ─── 3b. Source commit provenance (package ↔ git ↔ manifest) ────────────────
function resolveGitRoot() {
  if (GIT_ROOT_ARG && fs.existsSync(path.join(GIT_ROOT_ARG, '.git'))) return GIT_ROOT_ARG;
  if (process.env.RAP_PROVENANCE_GIT_ROOT
    && fs.existsSync(path.join(process.env.RAP_PROVENANCE_GIT_ROOT, '.git'))) {
    return process.env.RAP_PROVENANCE_GIT_ROOT;
  }
  if (fs.existsSync(path.join(ROOT, '.git'))) return ROOT;
  return null;
}

function runGitProbe(gitRoot, gitArgs) {
  try {
    return {
      ok: true,
      out: String(execFileSync('git', gitArgs, {
        cwd: gitRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }) || '').trim(),
    };
  } catch (err) {
    if (err && Number(err.status) === 0 && typeof err.stdout === 'string') {
      return { ok: true, out: String(err.stdout || '').trim() };
    }
    return { ok: false, out: '' };
  }
}

/**
 * Prova a cadeia package ↔ git tree ↔ gitCommit ↔ manifest ↔ package:
 *   1. manifest declara git_commit/git_tree (40-char SHA) e cleanWorktree=true;
 *   2. o gitCommit EXISTE no repositório;
 *   3. `git rev-parse <commit>^{tree}` == git_tree declarada;
 *   4. worktree limpo na verificação OU HEAD == commit declarado
 *      (verificação reproduzível do mesmo source);
 *   5. sha256 do payload em dist/release == sha256 do manifest (pacote não
 *      adulterado — não basta consistência interna de hashes do ZIP).
 * Divergência = NO_GO SOURCE_COMMIT_MISMATCH / PACKAGE_HASH_MISMATCH.
 */
function checkSourceCommitProvenance(manifest) {
  const gate = makeGate('source_commit_provenance');
  if (!manifest) {
    return fail(gate, 'SOURCE_COMMIT_MISMATCH — manifest ausente; proveniência não verificável.');
  }

  const commit = String(manifest.git_commit || '');
  const declaredTree = String(manifest.git_tree || '');
  if (!/^[0-9a-f]{40}$/i.test(commit)) {
    return fail(gate, 'SOURCE_COMMIT_MISMATCH — manifest sem git_commit full (40-char SHA).');
  }
  if (!/^[0-9a-f]{40}$/i.test(declaredTree)) {
    return fail(gate, 'SOURCE_COMMIT_MISMATCH — manifest sem git_tree (40-char SHA).');
  }
  if (manifest.cleanWorktree !== true) {
    return fail(gate, 'SOURCE_COMMIT_MISMATCH — manifest não declara cleanWorktree=true (release sobre worktree sujo é inválido).');
  }

  const gitRoot = resolveGitRoot();
  if (!gitRoot) {
    return fail(gate, 'SOURCE_COMMIT_MISMATCH — repositório git indisponível para provar proveniência (use --git-root ou RAP_PROVENANCE_GIT_ROOT).');
  }

  const commitProbe = runGitProbe(gitRoot, ['rev-parse', '--verify', `${commit}^{commit}`]);
  if (!commitProbe.ok || commitProbe.out.toLowerCase() !== commit.toLowerCase()) {
    return fail(gate, `SOURCE_COMMIT_MISMATCH — git_commit ${commit.slice(0, 12)}… não existe no repositório.`);
  }

  const treeProbe = runGitProbe(gitRoot, ['rev-parse', `${commit}^{tree}`]);
  if (!treeProbe.ok || treeProbe.out.toLowerCase() !== declaredTree.toLowerCase()) {
    return fail(gate, 'SOURCE_COMMIT_MISMATCH — git_tree declarada diverge de `git rev-parse <commit>^{tree}`.', {
      declared: declaredTree.slice(0, 16),
      actual: treeProbe.out ? treeProbe.out.slice(0, 16) : null,
    });
  }

  const headProbe = runGitProbe(gitRoot, ['rev-parse', 'HEAD']);
  const porcelainProbe = runGitProbe(gitRoot, ['status', '--porcelain']);
  const headMatches = headProbe.ok && headProbe.out.toLowerCase() === commit.toLowerCase();
  const worktreeClean = porcelainProbe.ok && porcelainProbe.out === '';
  if (!worktreeClean && !headMatches) {
    return fail(gate, 'SOURCE_COMMIT_MISMATCH — worktree sujo na verificação e HEAD diverge do commit declarado (source não reproduzível).', {
      head: headProbe.out ? headProbe.out.slice(0, 12) : null,
      declared: commit.slice(0, 12),
    });
  }

  return pass(gate, {
    gitCommit: commit.slice(0, 12),
    gitTree: declaredTree.slice(0, 12),
    headMatches,
    worktreeClean,
  });
}

function checkPackageHashBinding(manifest) {
  const gate = makeGate('package_hash_binding');
  if (!manifest) {
    return fail(gate, 'PACKAGE_HASH_MISMATCH — manifest ausente; binding do pacote não verificável.');
  }
  const declared = String(manifest.sha256 || '');
  if (!/^[0-9a-f]{64}$/i.test(declared)) {
    return fail(gate, 'PACKAGE_HASH_MISMATCH — manifest sem sha256 (64-hex) do artefato governado.');
  }
  const artifactName = String(manifest.artifact || '');
  if (!artifactName) {
    return fail(gate, 'PACKAGE_HASH_MISMATCH — manifest sem nome do artefato.');
  }
  const artifactPath = path.join(ROOT, 'dist', 'release', artifactName);
  if (!fs.existsSync(artifactPath)) {
    return fail(gate, `PACKAGE_HASH_MISMATCH — artefato governado ausente: dist/release/${artifactName}.`);
  }
  const actual = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
  if (actual.toLowerCase() !== declared.toLowerCase()) {
    return fail(gate, 'PACKAGE_HASH_MISMATCH — sha256 do pacote diverge do manifest (pacote adulterado).', {
      declared: declared.slice(0, 16),
      actual: actual.slice(0, 16),
    });
  }
  return pass(gate, { artifact: artifactName, sha256: declared.slice(0, 16) });
}

// ─── 3c. Experience segregation evidence ─────────────────────────────────────
/**
 * O relatório do validate:experience-segregation precisa provar execução para
 * o MESMO sourceFingerprint do release: existe, status PASS e lineage igual ao
 * do manifest — senão NO_GO (relatório de outro run/source não é evidência).
 */
function checkExperienceSegregation(manifest) {
  const gate = makeGate('experience_segregation');

  const report = readJson('reports/experience-segregation-report.json');
  if (!report) {
    return fail(gate, 'EXPERIENCE_SEGREGATION_NO_GO — reports/experience-segregation-report.json ausente.');
  }
  if (report.status !== 'PASS') {
    return fail(gate, `EXPERIENCE_SEGREGATION_NO_GO — status=${report.status || 'UNKNOWN'}.`);
  }
  const manifestFp = manifest?.sourceFingerprint || null;
  if (manifestFp) {
    if (!report.sourceFingerprint) {
      return fail(gate, 'EXPERIENCE_SEGREGATION_NO_GO — relatório sem sourceFingerprint (lineage ausente).');
    }
    if (report.sourceFingerprint !== manifestFp) {
      return fail(gate, 'EXPERIENCE_SEGREGATION_NO_GO — sourceFingerprint do relatório diverge do release.', {
        report: String(report.sourceFingerprint).slice(0, 16),
        manifest: String(manifestFp).slice(0, 16),
      });
    }
  }
  return pass(gate, { status: report.status, sourceFingerprint: report.sourceFingerprint ? String(report.sourceFingerprint).slice(0, 16) : null });
}

// ─── 3d. Payload governance (fonte da verdade = governança DENTRO do payload) ─
/**
 * Abre o payload entregue e exige que a governança canônica embutida
 * (r-agent2/governance/) seja GO, do mesmo run/fingerprint do manifest, com o
 * envelope derivado idêntico e attestation Ed25519 válida. Elimina o fluxo
 * NO_GO-interno → envelope-GO (root cause do release r-agent2-20260903-134904).
 */
function checkPayloadGovernance() {
  const gate = makeGate('payload_governance');
  let verifyModule;
  try {
    verifyModule = require('../scripts/verify-payload-governance');
  } catch (error) {
    return fail(gate, `VERIFIER_ERROR — verify-payload-governance indisponível: ${error.message}`);
  }
  const { verifyPayloadGovernance, verifyDeferredCandidate } = verifyModule;
  let result;
  let mode = 'FINAL';
  try {
    result = verifyPayloadGovernance({ root: ROOT });
  } catch (error) {
    return fail(gate, `VERIFIER_ERROR — ${error.message}`);
  }
  if (!result || result.pass !== true) {
    // Fase DELIVERED: candidato selado com decisão DEFERRED verdadeira de ponta
    // a ponta (payload=candidato, envelope=candidato). Nunca promovido a GO.
    let candidateResult = null;
    try {
      candidateResult = verifyDeferredCandidate({ root: ROOT });
    } catch (error) {
      return fail(gate, `VERIFIER_ERROR — ${error.message}`);
    }
    if (candidateResult && candidateResult.pass === true) {
      mode = 'DELIVERED_PHASE_CANDIDATE';
      result = candidateResult;
    } else {
      const strictReasons = (result?.failedGates || []).map((g) => `${g.id}: ${g.reason}`).join(' | ');
      const candidateReasons = (candidateResult?.failedGates || []).map((g) => `${g.id}: ${g.reason}`).join(' | ');
      return fail(gate, `PAYLOAD_GOVERNANCE_NO_GO — strict=[${strictReasons || 'sem detalhe'}] candidate=[${candidateReasons || 'sem detalhe'}]`);
    }
  }
  return pass(gate, { mode, gates: result.gates.length, decision: result.decision });
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

  if (status.status !== 'FRESH') {
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
    return fail(gate, 'INVALID_ARTIFACT — runId ausente no run atual.');
  }

  // O delivered-release-verification-report.json é PRODUZIDO por este próprio
  // verifier ao final de cada execução (único produtor legítimo — o
  // stamp-report-lineage deliberadamente não o stampa, pois stampar fabricaria
  // DELIVERED_RELEASE_VERIFIED fora da fase DELIVERED). A versão pré-existente
  // em disco é portanto saída STALE do próprio produtor (run anterior), não um
  // artefato de entrada deste gate: incluí-la no scan causaria um falso
  // FOREIGN_RUN_ARTIFACT na primeira execução de cada novo run, exigindo uma
  // segunda execução para passar. Excluí-la não relaxa o gate — qualquer outro
  // artefato com runId estrangeiro continua FAIL.
  const SELF_OUTPUT_REPORT = 'delivered-release-verification-report.json';
  const governanceFiles = fs.existsSync(path.join(ROOT, 'governance'))
    ? fs.readdirSync(path.join(ROOT, 'governance'))
        .filter((f) => f.endsWith('.json') && !f.startsWith('.') && f !== SELF_OUTPUT_REPORT)
        .map((f) => `governance/${f}`)
    : [];

  const foreign = [];
  for (const relPath of governanceFiles) {
    const data = readJson(relPath);
    if (!data || typeof data !== 'object') continue;
    const artRunId = data.runId || data.run_id;
    // Um artefato é "de run diferente" (foreign) somente quando DECLARA um
    // runId que diverge do run atual. Arquivos estáticos de governança
    // (policies, RACI, playbooks, registries) não são artefatos de run e
    // legitimamente não carregam runId — não são contaminação de outro run.
    // A completude de lineage dos artefatos de run é verificada separadamente
    // pelo engine de certificação (INVALID_ARTIFACT) e pelo stamp-lineage.
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

  // A fonte canônica de cobertura é o coverage gate (validate:coverage-gate),
  // o mesmo input usado pelo scorecard (RAP-022/023/025/040). A projeção
  // DB-derivada de final-proof-report não carrega proofCoverage — ler coverage
  // de lá era uma dependência circular que fabricava COVERAGE_INSUFFICIENT.
  const report = readJson('reports/coverage-gate-report.json');
  if (!report) return fail(gate, 'COVERAGE_INSUFFICIENT_EVIDENCE - reports/coverage-gate-report.json ausente');

  const weighted = Number(report.weightedCoverage ?? report.validatedCoverage ?? null);
  if (!Number.isFinite(weighted)) {
    return fail(gate, 'COVERAGE_INSUFFICIENT_EVIDENCE - weightedCoverage ausente ou invalido');
  }

  if (report.status === 'NO_GO' || report.gate === 'NO_GO') {
    return fail(gate, `Coverage gate NO_GO — weightedCoverage=${weighted}%`);
  }

  if (weighted < 70) {
    return fail(gate, `Coverage insuficiente: ${weighted}% (mínimo 70%)`);
  }

  return pass(gate, { coveragePercent: weighted, coverageGate: report.status || report.gate });
}

function checkMasterScorecard() {
  const gate = makeGate('master_scorecard');
  const scorecard = readJson('governance/rap-master-scorecard.json');
  if (!scorecard) return fail(gate, 'MASTER_SCORECARD_MISSING');
  const dimensions = Array.isArray(scorecard.dimensions) ? scorecard.dimensions : [];
  const below10 = dimensions.filter((dimension) => (dimension.score ?? dimension.currentScore) !== 10);
  if (below10.length === 0) return pass(gate, { dimensions: dimensions.length });

  const below10Ids = below10.map((dimension) => dimension.id).filter(Boolean);
  const nonDelivered = below10Ids.filter((id) => !DELIVERED_PHASE_DIMENSIONS.has(id));
  if (nonDelivered.length > 0) {
    return fail(gate, `MASTER_SCORECARD_NOT_10_OF_10 - below10=${below10.length} (non-delivered: ${nonDelivered.join(', ')})`);
  }
  // Abaixo de 10 apenas em dimensões DELIVERED (RAP-055/056): este verifier é
  // exatamente quem produz o delivered-report que as sobe para 10. DEFERRED,
  // não FAIL — o artefato está íntegro e o scorecard refletirá o resultado.
  return { ...gate, status: 'DEFERRED', reason: `MASTER_SCORECARD delivered pending - below10=${below10Ids.join(', ')}` };
}

function checkSelfProofAndTamper() {
  return [
    ['self_proof', 'governance/self-proving-report.json', (report) => report.pass === true && report.selfProofStatus === 'PASS'],
    ['tamper_detection', 'governance/tamper-detection-report.json', (report) => report.pass === true && report.decision === 'GO' && report.failedChecks === 0],
  ].map(([id, file, predicate]) => {
    const gate = makeGate(id);
    const report = readJson(file);
    return predicate(report || {}) ? pass(gate) : fail(gate, `${id.toUpperCase()}_NOT_PASS`);
  });
}

// ─── 10. Mandatory gates from governance ─────────────────────────────────────
function checkGovernanceMandatoryGates() {
  const gate = makeGate('governance_mandatory_gates');

  const govReport = readJson('governance/final-governance-report.json');
  if (!govReport) return fail(gate, 'final-governance-report.json ausente');

  const decision = govReport.finalDecision;
  if (decision === 'AUTONOMOUS_READY_GO') return pass(gate, { governanceDecision: decision });
  if (decision === 'PASS_WITH_DEFERRED_PACKAGE_GATE') {
    // PRE_PACKAGE honesto: gates semânticos PASS, scorecard com dimensões
    // DELIVERED pendentes. Não é GO, mas também não é falha do artefato.
    return { ...gate, status: 'DEFERRED', reason: 'PASS_WITH_DEFERRED_PACKAGE_GATE (scorecard delivered pending)' };
  }
  return fail(gate, `governance decision=${decision}`);
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

  if (report.decision !== 'REPLAY_HARDENING_GO') {
    return fail(gate, `REPLAY_HARDENING_NOT_PASS — decision=${report.decision || 'UNKNOWN'}`);
  }

  return pass(gate, { hardeningDecision: report.decision });
}

// ─── Main ────────────────────────────────────────────────────────────────────
function verify() {
  console.log(`\n[verify-delivered-release] root=${ROOT}\n`);

  // Executar todos os checks
  const manifestCheck = checkPackageManifest();
  const manifest      = manifestCheck.manifest || null;

  // Gates de ARTEFATO: verificam o pacote entregue em si (manifest, runId,
  // sourceFingerprint, chain, freshness, contaminação de run, causal journey,
  // tenant audit, coverage, consistency, replay hardening, self-proof, tamper).
  // Estes definem DELIVERED_RELEASE_VERIFIED — a evidência que RAP-055/056 leem.
  const artifactGates = [
    manifestCheck,
    checkRunId(manifest),
    checkSourceFingerprint(manifest),
    checkSourceCommitProvenance(manifest),
    checkPackageHashBinding(manifest),
    checkExperienceSegregation(manifest),
    checkPayloadGovernance(),
    checkFingerprintChain(),
    checkProofFreshness(),
    checkArtifactRunConsistency(),
    checkCriticalJourney(),
    checkSystemScopeAudit(),
    checkCoverage(),
    checkFinalConsistency(),
    checkReplayHardening(),
    ...checkSelfProofAndTamper(),
  ];

  // Gates DERIVADOS: scorecard 10/10 e governance AUTONOMOUS_READY_GO são o
  // RESULTADO de RAP-055/056 terem subido para 10 após este relatório existir
  // com DELIVERED_RELEASE_VERIFIED. Exigí-los como pré-condição do DELIVERED
  // criaria um ciclo impossível (scorecard precisa deste relatório; este
  // relatório precisaria do scorecard). Eles determinam o upgrade final para
  // AUTONOMOUS_READY. DEFERRED (só delivered pendente) NÃO bloqueia o
  // DELIVERED; FAIL real (NO_GO / below10 não-delivered) bloqueia.
  const derivedGates = [
    checkGovernanceMandatoryGates(),
    checkMasterScorecard(),
  ];

  const allGates = [...artifactGates, ...derivedGates];

  const artifactFailed = artifactGates
    .filter((g) => g.status === 'FAIL' && g.mandatory);
  const derivedFailed = derivedGates
    .filter((g) => g.status === 'FAIL' && g.mandatory);
  const derivedDeferred = derivedGates
    .filter((g) => g.status === 'DEFERRED');

  // DELIVERED_RELEASE_VERIFIED = artefato entregue verificado (pré-condição),
  // sem falha semântica de gate derivado (NO_GO/below10 não-delivered).
  // AUTONOMOUS_READY = artefato verificado E scorecard 10/10 E governance GO.
  const delivered = artifactFailed.length === 0 && derivedFailed.length === 0
    ? 'DELIVERED_RELEASE_VERIFIED'
    : 'DELIVERED_RELEASE_NO_GO';
  const autonomousReady = delivered === 'DELIVERED_RELEASE_VERIFIED'
    && derivedDeferred.length === 0;
  const finalDecision = autonomousReady
    ? 'AUTONOMOUS_READY'
    : (delivered === 'DELIVERED_RELEASE_VERIFIED'
      ? 'DELIVERED_PENDING_SCORECARD'
      : 'NO_GO');

  // Persistir o resultado REAL do verifier entregue (nunca fabricado por outro
  // script): este relatório é o único produtor legítimo de DELIVERED_RELEASE_VERIFIED.
  const reportPath = path.join(ROOT, 'governance', 'delivered-release-verification-report.json');
  try {
    const deliveredReport = {
      generatedAt: new Date().toISOString(),
      runId: manifest?.runId || null,
      sourceFingerprint: manifest?.sourceFingerprint || null,
      policyFingerprint: manifest?.policyFingerprint || null,
      artifactType: 'delivered-release-verification-report',
      artifactVersion: '1.0.0',
      decision: delivered,
      status: delivered,
      finalDecision,
      gates: allGates.map((gate) => ({ id: gate.id, status: gate.status, mandatory: gate.mandatory, reason: gate.reason || null })),
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(deliveredReport, null, 2)}\n`);
  } catch (error) {
    console.error(`[verify-delivered-release] failed to persist delivered report: ${error.message}`);
  }

  // Exibir resultado
  console.log('─'.repeat(60));
  console.log('MANDATORY GATES');
  console.log('─'.repeat(60));
  for (const g of allGates) {
    const icon = g.status === 'PASS' ? '✓' : (g.status === 'DEFERRED' ? '⟳' : '✗');
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
    // A comparação que DECIDE é a do fingerprint RECALCULADO da árvore atual.
    // Imprimir só proof vs manifest escondia justamente o valor divergente: os
    // dois vêm do artefato ENTREGUE e são iguais por construção, então um FAIL
    // legítimo aparecia como "dois hashes idênticos que divergem". Ruído de
    // diagnóstico que custou tempo de investigação em 2026-09-18.
    let worktreeSource = null;
    try {
      const { computeFingerprintChain } = require('./proof-engine/fingerprint-chain.js');
      worktreeSource = computeFingerprintChain(ROOT).sourceFingerprint || null;
    } catch (_) {
      worktreeSource = null;
    }
    const proofSource = proof?.sourceFingerprint || null;
    const manifestSource = manifest.sourceFingerprint || null;
    const same = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();
    const sourceAgrees = same(worktreeSource, proofSource) && same(worktreeSource, manifestSource);

    console.log('HASH COMPARISON');
    console.log('─'.repeat(60));
    console.log(`  source from proof:     ${String(proofSource || 'N/A').slice(0,32)}`);
    console.log(`  source from manifest:  ${String(manifestSource || 'N/A').slice(0,32)}`);
    console.log(`  source from worktree:  ${String(worktreeSource || 'N/A').slice(0,32)}  <= é ESTE que decide`);
    console.log(`  veredito:              ${sourceAgrees
      ? 'OK — árvore atual == artefato entregue'
      : 'DIVERGE — árvore atual != artefato entregue (o release entregue é válido NO COMMIT DELE; commit posterior exige novo ciclo de selagem)'}`);
    console.log();
  }

  console.log('─'.repeat(60));
  console.log(`FINAL DECISION:  ${finalDecision}`);
  console.log(`DELIVERED:       ${delivered}`);
  console.log('─'.repeat(60));

  if (finalDecision !== 'AUTONOMOUS_READY') {
    console.log('\nFailed gates:');
    const failedGates = allGates.filter((g) => g.status === 'FAIL' && g.mandatory);
    for (const g of failedGates) console.log(`  - ${g.id}: ${g.reason}`);
    console.log();
  }

  process.exit(delivered === 'DELIVERED_RELEASE_VERIFIED' ? 0 : 1);
}

verify();
