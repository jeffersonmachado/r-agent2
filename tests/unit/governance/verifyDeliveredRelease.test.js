'use strict';

/**
 * Testes para verify-delivered-release.js.
 *
 * Garante que o verifier:
 * 1. Rejeita quando package manifest é ausente (sem fallback sintético)
 * 2. Rejeita quando runId está ausente (sem fail-open pré-FINAL3)
 * 3. Rejeita quando sourceFingerprint diverge
 * 4. Rejeita quando critical-journey-evidence está ausente (sem fail-open)
 * 5. Rejeita quando system-scope-audit está ausente (sem fail-open)
 * 6. Rejeita quando mandatory gate falha
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Helpers para criar ambiente temporário de teste
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdr-test-'));
  return dir;
}

// ─── Proveniência git real para os gates source_commit_provenance ────────────
// Repositório temporário com dois commits; o manifest declara o commit HEAD
// (commitB/treeB). Nunca toca no repo real; o verifier é apontado para ele via
// RAP_PROVENANCE_GIT_ROOT.
function git(dir, args) {
  return String(execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) || '').trim();
}

function makeProvenanceRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdr-provenance-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'qa@example.com']);
  git(dir, ['config', 'user.name', 'QA']);
  fs.writeFileSync(path.join(dir, 'source.js'), "'use strict';\nmodule.exports = 1;\n");
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'commit A']);
  const commitA = git(dir, ['rev-parse', 'HEAD']);
  const treeA = git(dir, ['rev-parse', 'HEAD^{tree}']);
  fs.writeFileSync(path.join(dir, 'source.js'), "'use strict';\nmodule.exports = 2;\n");
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'commit B']);
  const commitB = git(dir, ['rev-parse', 'HEAD']);
  const treeB = git(dir, ['rev-parse', 'HEAD^{tree}']);
  return { dir, commitA, treeA, commitB, treeB };
}

function writeJson(dir, relPath, data) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8');
}

// Extrair gate status de saída do verifier
function parseGateStatuses(output) {
  const lines = output.split('\n');
  const gates = {};
  for (const line of lines) {
    const m = line.match(/\b([a-z][a-z0-9_]+)\s+(PASS|FAIL|DEFERRED)\b/);
    if (m) gates[m[1]] = m[2];
  }
  return gates;
}

// Executar o verifier em um diretório raiz customizado
function runVerifier(rootDir, extraEnv = {}) {
  const { spawnSync } = require('child_process');
  const verifierPath = path.join(__dirname, '..', '..', '..', 'governance', 'verify-delivered-release.js');
  const result = spawnSync(process.execPath, [verifierPath, '--root', rootDir], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..', '..', '..'),
    env: { ...process.env, ...extraEnv },
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: (result.stdout || '') + (result.stderr || ''),
    error: result.error || null,
  };
}

function updateJson(dir, relPath, mutate) {
  const abs = path.join(dir, relPath);
  const value = JSON.parse(fs.readFileSync(abs, 'utf8'));
  mutate(value);
  fs.writeFileSync(abs, JSON.stringify(value, null, 2), 'utf8');
}

// ─── Mínimo de artifacts válidos para um root que passa ──────────────────────
function buildMinimalValidRoot(dir, provenance) {
  const runId = 'rap-release-20260820-000000-testtest';
  const startedAt = '2026-08-20T00:00:00.000Z';
  const generatedAt = '2026-08-20T00:01:00.000Z';

  // Inventário e registry tornam todos os componentes da cadeia não nulos.
  writeJson(dir, 'config/system-inventory.json', { items: [{ id: 'api:test', fingerprint: 'fp-test' }] });
  writeJson(dir, 'qa/qa-waves/scenario-store.json', { scenarios: [{ id: 'scenario-test' }] });
  const fingerprints = require('../../../governance/proof-engine/fingerprint-chain').computeFingerprintChain(dir);
  const sourceFingerprint = fingerprints.sourceFingerprint;
  const lineage = (artifactType) => ({
    runId,
    sourceFingerprint,
    generatedAt,
    artifactType,
    artifactVersion: '1.0.0',
  });

  writeJson(dir, 'governance/.current-run.json', {
    ...lineage('run-context'),
    startedAt,
    status: 'PACKAGED',
    stageHistory: [],
  });

  const scorecard = {
    ...lineage('rap-master-scorecard'),
    schema: 'rap-master-scorecard/v2',
    dimensions: [{
      id: 'RAP-001', name: 'Verifier', score: 10, target: 10, status: 'VERIFIED',
      requirements: [{ id: 'delivered', mandatory: true, status: 'PASS' }],
      tests: ['tests/unit/governance/verifyDeliveredRelease.test.js'],
      runtimeEvidence: ['governance/critical-journey-evidence.json'],
      blockers: [], gaps: [],
    }],
    blockers: [], gaps: [],
  };
  writeJson(dir, 'governance/rap-master-scorecard.json', scorecard);

  const proof = {
    ...lineage('final-proof-report'),
    finalDecision: 'AUTONOMOUS_READY_GO',
    fingerprintStatus: 'FRESH',
    fingerprintChain: { status: 'FRESH' },
    proofCoverage: { total: 1, valid: 1, percent: 100 },
    blockerCount: 0,
    missingArtifacts: [],
    sourceFingerprint,
    inventoryFingerprint: fingerprints.inventoryFingerprint,
    scenarioFingerprint: fingerprints.scenarioRegistryFingerprint,
    policyFingerprint: fingerprints.policyFingerprint,
    chainFingerprint: fingerprints.chainFingerprint,
  };
  writeJson(dir, 'governance/final-proof-report.json', proof);

  writeJson(dir, 'governance/evidence-manifest.json', {
    ...lineage('evidence-manifest'),
    fingerprints,
    artifacts: [],
  });

  writeJson(dir, 'governance/final-governance-report.json', {
    ...lineage('final-governance-report'),
    finalDecision: 'AUTONOMOUS_READY_GO', autonomousReady: true, allChecksPass: true,
    checks: [{ id: 'authority', pass: true }],
  });

  writeJson(dir, 'governance/final-readiness-report.json', {
    ...lineage('final-readiness-report'),
    finalDecision: 'AUTONOMOUS_READY_GO', status: 'AUTONOMOUS_READY_GO', blockingGaps: [],
  });

  writeJson(dir, 'governance/final-consistency-gate-report.json', {
    ...lineage('final-consistency-report'),
    decision: 'FINAL_CONSISTENCY_GO', pass: true, failures: [],
    checks: [{ id: 'authority', pass: true }],
  });

  writeJson(dir, 'governance/replay-hardening-report.json', {
    ...lineage('replay-hardening-report'),
    decision: 'REPLAY_HARDENING_GO', pass: true, violations: 0,
  });

  // critical-journey-evidence.json com cadeia real (sem IDs sintéticos verificados)
  writeJson(dir, 'governance/critical-journey-evidence.json', {
    ...lineage('critical-journey-evidence'),
    decision: 'CRITICAL_JOURNEY_VALIDATED',
    pass: true,
    causalChain: [
      { eventType: 'INBOUND_MESSAGE',    correlationId: 'real-corr-001', tenantId: 't1', eventId: 'real-evt-001' },
      { eventType: 'COGNITIVE_DECISION', correlationId: 'real-corr-001', tenantId: 't1', eventId: 'real-evt-002' },
      { eventType: 'HANDOFF_REQUEST',    correlationId: 'real-corr-001', tenantId: 't1', eventId: 'real-evt-003' },
      { eventType: 'HUMAN_TAKEOVER',     correlationId: 'real-corr-001', tenantId: 't1', eventId: 'real-evt-004' },
      { eventType: 'BACKEND_MUTATION',   correlationId: 'real-corr-001', tenantId: 't1', eventId: 'real-evt-005' },
      { eventType: 'BUSINESS_OUTCOME',   correlationId: 'real-corr-001', tenantId: 't1', eventId: 'real-evt-006' },
    ],
  });

  // system-scope-audit.json
  writeJson(dir, 'governance/system-scope-audit.json', {
    ...lineage('system-scope-audit'),
    decision: 'NO_RUNTIME_FAIL_OPEN',
    pass: true,
    runtimeFailOpenCount: 0,
    totalFindings: 10,
  });

  writeJson(dir, 'governance/self-proving-report.json', {
    ...lineage('self-proving-report'),
    pass: true, selfProofStatus: 'PASS', verifierPassed: true,
    staleReferencesFound: 0, staleHashesFound: 0,
    selfProofGate: { failedGates: [] },
  });

  writeJson(dir, 'governance/tamper-detection-report.json', {
    ...lineage('tamper-detection-report'),
    pass: true, decision: 'GO', failedChecks: 0,
    checks: [{ id: 'package', pass: true }],
  });

  writeJson(dir, 'governance/package-validation-report.json', {
    ...lineage('package-validation-report'), ok: true, pass: true,
  });
  writeJson(dir, 'governance/package-integrity-report.json', {
    ...lineage('package-integrity-report'), pass: true, decision: 'PACKAGE_INTEGRITY_GO',
    checks: [{ id: 'hash', pass: true }], failedChecks: 0,
  });

  // Fonte canônica de coverage lida por checkCoverage (validate:coverage-gate).
  writeJson(dir, 'reports/coverage-gate-report.json', {
    ...lineage('coverage-gate-report'),
    status: 'GO', weightedCoverage: 99.9, validatedCoverage: 99.9, critical: { failed: 0 },
  });

  // Evidência de segregação de experiência para o MESMO sourceFingerprint.
  writeJson(dir, 'reports/experience-segregation-report.json', {
    ...lineage('experience-segregation-report'),
    status: 'PASS',
    violationCount: 0,
    violations: [],
  });

  const payloadPath = path.join(dir, 'dist', 'release', 'r-agent2-20260820-000000.payload.zip');
  fs.mkdirSync(path.dirname(payloadPath), { recursive: true });
  fs.writeFileSync(payloadPath, 'immutable payload bytes', 'utf8');
  const packageFingerprint = crypto.createHash('sha256').update(fs.readFileSync(payloadPath)).digest('hex');
  const proofFingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'governance', 'final-proof-report.json'))).digest('hex');
  const scorecardFingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'governance', 'rap-master-scorecard.json'))).digest('hex');
  writeJson(dir, 'dist/release/r-agent2-20260820-000000.manifest.json', {
    ...lineage('package-manifest'),
    artifact: path.basename(payloadPath),
    sha256: packageFingerprint,
    packageFingerprint,
    sourceFingerprint,
    inventoryFingerprint: fingerprints.inventoryFingerprint,
    scenarioFingerprint: fingerprints.scenarioRegistryFingerprint,
    policyFingerprint: fingerprints.policyFingerprint,
    proofFingerprint,
    chainFingerprint: fingerprints.chainFingerprint,
    scorecardFingerprint,
    git_commit: provenance.commitB,
    git_tree: provenance.treeB,
    git_branch: 'main',
    git_ref: 'refs/heads/main',
    cleanWorktree: true,
    createdAt: generatedAt,
    audit: 'passed',
  });

  return { runId, sourceFingerprint, fingerprints };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('verify-delivered-release — fail-closed behavior', () => {
  let provenance;

  beforeEach(() => {
    provenance = makeProvenanceRepo();
    process.env.RAP_PROVENANCE_GIT_ROOT = provenance.dir;
  });

  afterEach(() => {
    delete process.env.RAP_PROVENANCE_GIT_ROOT;
    if (provenance) fs.rmSync(provenance.dir, { recursive: true, force: true });
    provenance = null;
  });

  test('PASS only for a complete same-run delivered root', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    const result = runVerifier(dir);
    expect(result.error).toBeNull();
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('DELIVERED_RELEASE_VERIFIED');
  });

  test('DELIVERED_RELEASE_VERIFIED when only DELIVERED-phase dims pending (PRE_PACKAGE → DELIVERED fixpoint)', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    // Scorecard com RAP-055/056 abaixo de 10 (fase DELIVERED pendente) e
    // governance PASS_WITH_DEFERRED_PACKAGE_GATE. O artefato está íntegro:
    // DELIVERED_RELEASE_VERIFIED (exit 0), mas finalDecision ainda não é
    // AUTONOMOUS_READY — o scorecard sobe para 10 na re-execução seguinte.
    writeJson(dir, 'governance/rap-master-scorecard.json', {
      runId: 'rap-release-20260820-000000-testtest',
      generatedAt: '2026-08-20T00:01:00.000Z',
      artifactType: 'rap-master-scorecard', artifactVersion: '1.0.0',
      dimensions: [
        { id: 'RAP-055', name: 'Delivered', score: 6, target: 10 },
        { id: 'RAP-056', name: 'Source/Proof', score: 6, target: 10 },
      ],
    });
    writeJson(dir, 'governance/final-governance-report.json', {
      runId: 'rap-release-20260820-000000-testtest',
      generatedAt: '2026-08-20T00:01:00.000Z',
      finalDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE',
    });

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('DELIVERED_RELEASE_VERIFIED');
    expect(result.output).toContain('DELIVERED_PENDING_SCORECARD');
    const gates = parseGateStatuses(result.output);
    expect(gates.master_scorecard).toBe('DEFERRED');
    expect(gates.governance_mandatory_gates).toBe('DEFERRED');
  });

  test('FAIL when package manifest is absent (no synthetic fallback allowed)', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    // Remove manifest
    fs.rmSync(path.join(dir, 'dist', 'release'), { recursive: true, force: true });

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['package_manifest']).toBe('FAIL');
    // Verificar que não usou fallback sintético
    expect(result.output).not.toContain('_syntheticFromProof');
  });

  test('FAIL when runId is absent in both manifest and .current-run.json', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    // Remove runId from manifest
    const manifestPath = path.join(dir, 'dist', 'release', 'r-agent2-20260820-000000.manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.runId;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    // Remove current-run.json
    fs.unlinkSync(path.join(dir, 'governance', '.current-run.json'));

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['run_id_consistency']).toBe('FAIL');
  });

  test('FAIL when critical-journey-evidence.json is absent', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    fs.unlinkSync(path.join(dir, 'governance', 'critical-journey-evidence.json'));

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['critical_causal_journey']).toBe('FAIL');
  });

  test('FAIL when system-scope-audit.json is absent', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    fs.unlinkSync(path.join(dir, 'governance', 'system-scope-audit.json'));

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['tenant_system_audit']).toBe('FAIL');
  });

  test('FAIL when mandatory governance gate reports NO_GO', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    // Override governance to NO_GO
    writeJson(dir, 'governance/final-governance-report.json', {
      finalDecision: 'NO_GO:SOMETHING',
      runId: 'rap-release-20260820-000000-testtest',
      generatedAt: new Date().toISOString(),
    });

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['governance_mandatory_gates']).toBe('FAIL');
  });

  test('FAIL when causal chain is missing required event type', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    // Remove HUMAN_TAKEOVER from chain
    writeJson(dir, 'governance/critical-journey-evidence.json', {
      decision: 'CRITICAL_JOURNEY_VALIDATED',
      runId: 'rap-release-20260820-000000-testtest',
      generatedAt: new Date().toISOString(),
      causalChain: [
        { eventType: 'INBOUND_MESSAGE',    correlationId: 'c1', tenantId: 't1' },
        { eventType: 'COGNITIVE_DECISION', correlationId: 'c1', tenantId: 't1' },
        { eventType: 'HANDOFF_REQUEST',    correlationId: 'c1', tenantId: 't1' },
        // HUMAN_TAKEOVER missing
        { eventType: 'BACKEND_MUTATION',   correlationId: 'c1', tenantId: 't1' },
        { eventType: 'BUSINESS_OUTCOME',   correlationId: 'c1', tenantId: 't1' },
      ],
    });

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['critical_causal_journey']).toBe('FAIL');
  });

  test('FAIL when correlationId diverges in causal chain (cross-correlation)', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    writeJson(dir, 'governance/critical-journey-evidence.json', {
      decision: 'CRITICAL_JOURNEY_VALIDATED',
      runId: 'rap-release-20260820-000000-testtest',
      generatedAt: new Date().toISOString(),
      causalChain: [
        { eventType: 'INBOUND_MESSAGE',    correlationId: 'corr-A', tenantId: 't1' },
        { eventType: 'COGNITIVE_DECISION', correlationId: 'corr-A', tenantId: 't1' },
        { eventType: 'HANDOFF_REQUEST',    correlationId: 'corr-A', tenantId: 't1' },
        { eventType: 'HUMAN_TAKEOVER',     correlationId: 'corr-B', tenantId: 't1' }, // diverge!
        { eventType: 'BACKEND_MUTATION',   correlationId: 'corr-B', tenantId: 't1' },
        { eventType: 'BUSINESS_OUTCOME',   correlationId: 'corr-B', tenantId: 't1' },
      ],
    });

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['critical_causal_journey']).toBe('FAIL');
  });

  test('FAIL when runtimeFailOpen > 0 in system scope audit', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    writeJson(dir, 'governance/system-scope-audit.json', {
      runtimeFailOpenCount: 2,
      totalFindings: 10,
      generatedAt: new Date().toISOString(),
    });

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['tenant_system_audit']).toBe('FAIL');
  });

  test('FAIL when proof fingerprint is missing (absence cannot match)', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'governance/final-proof-report.json', (proof) => { delete proof.sourceFingerprint; });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).source_fingerprint).toBe('FAIL');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when any governed artifact has a foreign runId', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'governance/replay-hardening-report.json', (report) => {
      report.runId = 'rap-release-99999999-000000-foreign';
    });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).artifact_run_consistency).toBe('FAIL');
    expect(result.exitCode).toBe(1);
  });

  // Regressão: o delivered-release-verification-report.json é saída do próprio
  // verifier (único produtor legítimo). Sua versão pré-existente em disco vem
  // do run ANTERIOR e não é artefato de entrada — não pode causar falso
  // FOREIGN_RUN_ARTIFACT na primeira execução de um novo run.
  test('PASS when only the verifier own stale output carries a foreign runId (first run of a new governed run)', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    writeJson(dir, 'governance/delivered-release-verification-report.json', {
      generatedAt: '2026-08-19T23:59:00.000Z',
      runId: 'rap-release-20260819-000000-previous',
      sourceFingerprint: 'f'.repeat(64),
      artifactType: 'delivered-release-verification-report',
      artifactVersion: '1.0.0',
      decision: 'DELIVERED_RELEASE_VERIFIED',
      status: 'DELIVERED_RELEASE_VERIFIED',
      finalDecision: 'AUTONOMOUS_READY',
      gates: [],
    });
    const result = runVerifier(dir);
    expect(result.error).toBeNull();
    expect(parseGateStatuses(result.output).artifact_run_consistency).toBe('PASS');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('DELIVERED_RELEASE_VERIFIED');
    // E a execução regravou o relatório com o runId do run atual.
    const rewritten = JSON.parse(
      fs.readFileSync(path.join(dir, 'governance', 'delivered-release-verification-report.json'), 'utf8')
    );
    expect(rewritten.runId).toBe('rap-release-20260820-000000-testtest');
  });

  test('FAIL when verifier own output is stale AND another artifact is also foreign', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    writeJson(dir, 'governance/delivered-release-verification-report.json', {
      runId: 'rap-release-20260819-000000-previous',
      artifactType: 'delivered-release-verification-report',
    });
    updateJson(dir, 'governance/replay-hardening-report.json', (report) => {
      report.runId = 'rap-release-99999999-000000-foreign';
    });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).artifact_run_consistency).toBe('FAIL');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when fingerprint chain is UNREGISTERED', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'governance/evidence-manifest.json', (manifest) => { delete manifest.fingerprints; });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).fingerprint_chain).toBe('FAIL');
  });

  test('FAIL when coverage is missing instead of treating null as PASS', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    fs.rmSync(path.join(dir, 'reports', 'coverage-gate-report.json'));
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).coverage).toBe('FAIL');
    expect(result.exitCode).toBe(1);
  });

  test('coverage gate NO_GO blocks DELIVERED even with weightedCoverage', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'reports/coverage-gate-report.json', (report) => { report.status = 'NO_GO'; });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).coverage).toBe('FAIL');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when replay status is UNKNOWN', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'governance/replay-hardening-report.json', (report) => { report.decision = 'UNKNOWN'; });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).replay_hardening).toBe('FAIL');
  });

  test('FAIL when scorecard contains a dimension below 10', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'governance/rap-master-scorecard.json', (scorecard) => { scorecard.dimensions[0].score = 9; });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).master_scorecard).toBe('FAIL');
  });

  test('FAIL when self-proof or tamper detection is not PASS', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'governance/self-proving-report.json', (report) => { report.pass = false; report.selfProofStatus = 'FAIL'; });
    updateJson(dir, 'governance/tamper-detection-report.json', (report) => { report.pass = false; report.decision = 'NO_GO'; });
    const result = runVerifier(dir);
    const gates = parseGateStatuses(result.output);
    expect(gates.self_proof).toBe('FAIL');
    expect(gates.tamper_detection).toBe('FAIL');
  });

  // ─── Proveniência reproduzível (Gap 4) ────────────────────────────────────
  test('FAIL when manifest git_commit does not exist in the repo', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'dist/release/r-agent2-20260820-000000.manifest.json', (manifest) => {
      manifest.git_commit = 'f'.repeat(40);
    });
    const result = runVerifier(dir);
    const gates = parseGateStatuses(result.output);
    expect(gates.source_commit_provenance).toBe('FAIL');
    expect(result.output).toContain('SOURCE_COMMIT_MISMATCH');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when manifest git_tree diverges from git rev-parse <commit>^{tree}', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'dist/release/r-agent2-20260820-000000.manifest.json', (manifest) => {
      manifest.git_tree = provenance.treeA; // tree de outro commit
    });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).source_commit_provenance).toBe('FAIL');
    expect(result.output).toContain('SOURCE_COMMIT_MISMATCH');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when manifest omite cleanWorktree=true (release sobre worktree sujo)', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'dist/release/r-agent2-20260820-000000.manifest.json', (manifest) => {
      delete manifest.cleanWorktree;
    });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).source_commit_provenance).toBe('FAIL');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when worktree is dirty at verification AND HEAD diverges from declared commit', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    // Declara o commit A enquanto HEAD está em B e o worktree fica sujo:
    // a verificação não é reproduzível para o source declarado.
    updateJson(dir, 'dist/release/r-agent2-20260820-000000.manifest.json', (manifest) => {
      manifest.git_commit = provenance.commitA;
      manifest.git_tree = provenance.treeA;
    });
    fs.appendFileSync(path.join(provenance.dir, 'source.js'), '// dirty at verification\n');
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).source_commit_provenance).toBe('FAIL');
    expect(result.output).toContain('SOURCE_COMMIT_MISMATCH');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when delivered package is tampered (sha256 diverge do manifest)', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    fs.appendFileSync(path.join(dir, 'dist', 'release', 'r-agent2-20260820-000000.payload.zip'), 'tampered');
    const result = runVerifier(dir);
    const gates = parseGateStatuses(result.output);
    expect(gates.package_hash_binding).toBe('FAIL');
    expect(result.output).toContain('PACKAGE_HASH_MISMATCH');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when manifest sourceFingerprint diverges from proof reports', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'dist/release/r-agent2-20260820-000000.manifest.json', (manifest) => {
      manifest.sourceFingerprint = '0'.repeat(64);
    });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).source_fingerprint).toBe('FAIL');
    expect(result.output).toContain('DELIVERED_SOURCE_MISMATCH');
    expect(result.exitCode).toBe(1);
  });

  // ─── Evidência de experience-segregation no release (Gap 6) ───────────────
  test('FAIL when experience-segregation report is absent', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    fs.rmSync(path.join(dir, 'reports', 'experience-segregation-report.json'));
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).experience_segregation).toBe('FAIL');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when experience-segregation report status is not PASS', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'reports/experience-segregation-report.json', (report) => { report.status = 'FAIL'; });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).experience_segregation).toBe('FAIL');
    expect(result.exitCode).toBe(1);
  });

  test('FAIL when experience-segregation report was produced for another sourceFingerprint', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir, provenance);
    updateJson(dir, 'reports/experience-segregation-report.json', (report) => {
      report.sourceFingerprint = '1'.repeat(64);
    });
    const result = runVerifier(dir);
    expect(parseGateStatuses(result.output).experience_segregation).toBe('FAIL');
    expect(result.exitCode).toBe(1);
  });
});
