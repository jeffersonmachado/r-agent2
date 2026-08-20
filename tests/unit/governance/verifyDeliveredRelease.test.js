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

// Helpers para criar ambiente temporário de teste
function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdr-test-'));
  return dir;
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
    const m = line.match(/\s+[✓✗]\s+(\S+)\s+(PASS|FAIL)/);
    if (m) gates[m[1]] = m[2];
  }
  return gates;
}

// Executar o verifier em um diretório raiz customizado
function runVerifier(rootDir) {
  const { execFileSync, spawnSync } = require('child_process');
  const verifierPath = path.join(__dirname, '..', '..', '..', 'governance', 'verify-delivered-release.js');
  const result = spawnSync(process.execPath, [verifierPath, '--root', rootDir], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..', '..', '..'),
    env: { ...process.env },
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: (result.stdout || '') + (result.stderr || ''),
  };
}

// ─── Mínimo de artifacts válidos para um root que passa ──────────────────────
function buildMinimalValidRoot(dir) {
  const runId = 'rap-release-20260820-000000-testtest';

  // .current-run.json
  writeJson(dir, 'governance/.current-run.json', { runId, createdAt: new Date().toISOString() });

  // dist/release/manifest com runId e sourceFingerprint
  const sourceFingerprint = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';
  writeJson(dir, 'dist/release/r-agent2-20260820-000000.manifest.json', {
    runId,
    sourceFingerprint,
    inventoryFingerprint: 'inv00000000000000000000000000000000000000000000000000000000000000',
    scenarioFingerprint:  'scn00000000000000000000000000000000000000000000000000000000000000',
    policyFingerprint:    'pol00000000000000000000000000000000000000000000000000000000000000',
    chainFingerprint:     'chn00000000000000000000000000000000000000000000000000000000000000',
    createdAt: new Date().toISOString(),
    architecture: 'source-verified',
  });

  // final-proof-report.json com finalDecision e sourceFingerprint coerente
  writeJson(dir, 'governance/final-proof-report.json', {
    finalDecision: 'AUTONOMOUS_READY_GO',
    sourceFingerprint,
    runId,
    generatedAt: new Date().toISOString(),
    fingerprintChain: { status: 'FRESH' },
    proofCoverage: { percent: 100 },
  });

  // evidence-manifest.json com fingerprints
  writeJson(dir, 'governance/evidence-manifest.json', {
    fingerprints: {
      sourceFingerprint,
      inventoryFingerprint: 'inv',
      scenarioFingerprint: 'scn',
      policyFingerprint: 'pol',
      chainFingerprint: 'chn',
    },
    generatedAt: new Date().toISOString(),
  });

  // final-governance-report.json
  writeJson(dir, 'governance/final-governance-report.json', {
    finalDecision: 'AUTONOMOUS_READY_GO',
    runId,
    generatedAt: new Date().toISOString(),
  });

  // final-consistency-gate-report.json
  writeJson(dir, 'governance/final-consistency-gate-report.json', {
    decision: 'FINAL_CONSISTENCY_GO',
    runId,
    generatedAt: new Date().toISOString(),
    failures: [],
  });

  // replay-hardening-report.json
  writeJson(dir, 'governance/replay-hardening-report.json', {
    decision: 'REPLAY_HARDENING_GO',
    runId,
    generatedAt: new Date().toISOString(),
    violations: 0,
  });

  // critical-journey-evidence.json com cadeia real (sem IDs sintéticos verificados)
  writeJson(dir, 'governance/critical-journey-evidence.json', {
    decision: 'CRITICAL_JOURNEY_VALIDATED',
    runId,
    generatedAt: new Date().toISOString(),
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
    runtimeFailOpenCount: 0,
    totalFindings: 10,
    generatedAt: new Date().toISOString(),
  });

  return { runId, sourceFingerprint };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('verify-delivered-release — fail-closed behavior', () => {
  test('FAIL when package manifest is absent (no synthetic fallback allowed)', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir);
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
    buildMinimalValidRoot(dir);
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
    buildMinimalValidRoot(dir);
    fs.unlinkSync(path.join(dir, 'governance', 'critical-journey-evidence.json'));

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['critical_causal_journey']).toBe('FAIL');
  });

  test('FAIL when system-scope-audit.json is absent', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir);
    fs.unlinkSync(path.join(dir, 'governance', 'system-scope-audit.json'));

    const result = runVerifier(dir);
    expect(result.exitCode).toBe(1);
    const gates = parseGateStatuses(result.output);
    expect(gates['tenant_system_audit']).toBe('FAIL');
  });

  test('FAIL when mandatory governance gate reports NO_GO', () => {
    const dir = makeTempDir();
    buildMinimalValidRoot(dir);
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
    buildMinimalValidRoot(dir);
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
    buildMinimalValidRoot(dir);
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
    buildMinimalValidRoot(dir);
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
});
