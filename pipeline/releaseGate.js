'use strict';

/**
 * pipeline/releaseGate.js
 *
 * Release Gate canônico do RAP.
 *
 * Bloqueia release quando:
 *   - stability score < threshold
 *   - blockers ativos
 *   - regressão detectada
 *   - replay consistency < threshold
 *   - evidências faltando
 *
 * Persiste decisão em:
 *   - qa/reports/release-gate.json
 *   - qa/reports/release-gate.md
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'qa', 'reports');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadLatestMeshExecution() {
  const historyDir = path.join(ROOT, 'qa-mesh', 'meshHistory');
  const files = safeReadJson(path.join(ROOT, 'qa-mesh', 'meshReport.json'), null);
  if (files) return files;

  try {
    const candidates = fs.readdirSync(historyDir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .reverse();
    for (const fileName of candidates) {
      const execution = safeReadJson(path.join(historyDir, fileName), null);
      if (execution) return execution;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeCheckpointFailures(checkpointsData) {
  if (Array.isArray(checkpointsData?.failures)) return checkpointsData.failures;
  if (Array.isArray(checkpointsData)) return checkpointsData;
  if (Array.isArray(checkpointsData?.failures?.failures)) return checkpointsData.failures.failures;
  return [];
}

// ─── Load policies ────────────────────────────────────────────────────────────

function loadPolicies() {
  try {
    return require('../qa/policies/index').loadPolicies();
  } catch {
    // fallback defaults if policies module not available
    return {
      releaseGate: {
        minStabilityScore: 70,
        requireZeroBlockers: true,
        requireReplayConsistency: true,
        requireCheckpointCompletion: true,
        requireEvidencePackage: true,
        replayConsistencyThreshold: 0.85,
      },
      stability: {
        minScore: 70,
        minCriticalScore: 80,
        maxBlockers: 0,
        regressionThreshold: 5,
      },
    };
  }
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const THRESHOLDS = {
  MIN_STABILITY_SCORE: Number(process.env.RELEASE_GATE_MIN_STABILITY || '70'),
  MAX_BLOCKERS: Number(process.env.RELEASE_GATE_MAX_BLOCKERS || '0'),
  MAX_CRITICAL_BLOCKERS: Number(process.env.RELEASE_GATE_MAX_CRITICAL_BLOCKERS || '0'),
  REGRESSION_MAX_DELTA: Number(process.env.RELEASE_GATE_REGRESSION_MAX_DELTA || '5'),
  REPLAY_CONSISTENCY_MIN: Number(process.env.RELEASE_GATE_REPLAY_MIN || '0.85'),
  REQUIRE_EVIDENCE: process.env.RELEASE_GATE_REQUIRE_EVIDENCE !== '0',
};

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Avalia o release gate com base nos artefatos de QA disponíveis.
 *
 * @param {object} options
 * @param {string} [options.reportsDir] - Diretório de relatórios QA
 * @param {object} [options.overrideData] - Dados de override (para uso pelo pipeline)
 * @returns {object} Gate result com decision, blockers, thresholds
 */
function evaluateGate(options = {}) {
  const reportsDir = options.reportsDir || REPORTS_DIR;
  const policies = loadPolicies();
  const gate = policies.releaseGate;

  // Merge policy thresholds with env override
  const thresholds = {
    minStabilityScore: Math.max(THRESHOLDS.MIN_STABILITY_SCORE, gate.minStabilityScore || 70),
    maxBlockers: THRESHOLDS.MAX_BLOCKERS,
    regressionMaxDelta: THRESHOLDS.REGRESSION_MAX_DELTA,
    replayConsistencyMin: THRESHOLDS.REPLAY_CONSISTENCY_MIN,
    requireEvidence: THRESHOLDS.REQUIRE_EVIDENCE,
  };

  const blockers = [];
  const warnings = [];
  const checks = {};

  // ── 1. Stability Score ──────────────────────────────────────────────────
  const stabilityData = options.overrideData?.stability || safeReadJson(path.join(reportsDir, 'stability.json'));
  const stabilityScore = stabilityData?.snapshot?.global?.stabilityScore ?? stabilityData?.snapshot?.overallScore ?? stabilityData?.score ?? null;
  checks.stability = {
    score: stabilityScore,
    threshold: thresholds.minStabilityScore,
    passed: stabilityScore === null || stabilityScore >= thresholds.minStabilityScore,
  };
  if (stabilityScore !== null && stabilityScore < thresholds.minStabilityScore) {
    blockers.push(`stability_score_below_threshold: ${stabilityScore} < ${thresholds.minStabilityScore}`);
  }
  if (stabilityScore === null) {
    warnings.push('stability_score_unavailable: snapshot não gerado nesta execução');
  }

  // ── 2. Active Blockers ──────────────────────────────────────────────────
  const checkpointsData = options.overrideData?.checkpoints || safeReadJson(path.join(reportsDir, 'checkpoints.json'));
  const checkpointFailures = normalizeCheckpointFailures(checkpointsData);
  const activeFailures = checkpointFailures.length;
  checks.checkpoints = {
    activeFailures,
    maxAllowed: thresholds.maxBlockers,
    passed: activeFailures <= thresholds.maxBlockers,
  };
  if (activeFailures > thresholds.maxBlockers) {
    blockers.push(`active_checkpoint_failures: ${activeFailures} (max: ${thresholds.maxBlockers})`);
  }

  // ── 3. Mesh Canonical State ────────────────────────────────────────────
  const meshData = options.overrideData?.mesh || loadLatestMeshExecution();
  const meshStatus = meshData?.summary?.goNoGo ?? meshData?.goNoGo ?? meshData?.status ?? meshData?.gate ?? null;
  checks.mesh = {
    status: meshStatus,
    passed: meshStatus === 'GO',
  };
  if (meshStatus === 'NO_GO') {
    blockers.push('qa_mesh_no_go');
  }
  if (meshStatus === 'GO_DEGRADED') {
    blockers.push('qa_mesh_degraded');
  }
  if (!meshStatus) {
    warnings.push('qa_mesh_status_unavailable: execução do mesh não encontrada');
  }

  // ── 4. Critical Replay Consistency ─────────────────────────────────────
  const executionData = options.overrideData?.execution || safeReadJson(path.join(reportsDir, 'execution.json'));
  const replayStep = (executionData?.steps || []).find((step) => step.name === 'replay-critical');
  checks.replay = {
    executed: Boolean(replayStep),
    passed: replayStep ? replayStep.success === true : false,
  };
  if (!replayStep) {
    blockers.push('critical_replay_missing');
  } else if (!replayStep.success) {
    blockers.push('critical_replay_failed');
  }

  // ── 5. Regression Detection ─────────────────────────────────────────────
  const stabilityHistoryPath = path.join(ROOT, 'qa', 'mesh', 'intelligence', 'history', 'index.json');
  const stabilityHistory = safeReadJson(stabilityHistoryPath, []);
  const previousScore = Array.isArray(stabilityHistory) && stabilityHistory.length > 1
    ? stabilityHistory[stabilityHistory.length - 2]?.snapshot?.overallScore ?? null
    : null;
  const regression = stabilityScore !== null && previousScore !== null
    ? previousScore - stabilityScore
    : null;
  checks.regression = {
    previousScore,
    currentScore: stabilityScore,
    delta: regression,
    maxAllowedDelta: thresholds.regressionMaxDelta,
    passed: regression === null || regression <= thresholds.regressionMaxDelta,
  };
  if (regression !== null && regression > thresholds.regressionMaxDelta) {
    blockers.push(`regression_detected: score dropped ${regression.toFixed(1)} points (max: ${thresholds.regressionMaxDelta})`);
  }

  // ── 6. Evidence Package ─────────────────────────────────────────────────
  if (thresholds.requireEvidence) {
    const { verifyEvidencePackage } = require('./evidenceEnforcer');
    const evidenceResult = verifyEvidencePackage(reportsDir);
    checks.evidence = {
      passed: evidenceResult.passed,
      missing: evidenceResult.missing,
      corrupted: evidenceResult.corrupted,
    };
    if (!evidenceResult.passed) {
      if (evidenceResult.missing.length > 0) {
        blockers.push(`evidence_missing: ${evidenceResult.missing.join(', ')}`);
      }
      if (evidenceResult.corrupted.length > 0) {
        blockers.push(`evidence_corrupted: ${evidenceResult.corrupted.join(', ')}`);
      }
    }
  }

  // ── 7. Pipeline Steps ───────────────────────────────────────────────────
  if (executionData) {
    const failedSteps = (executionData.steps || []).filter((s) => !s.success).map((s) => s.name);
    checks.pipelineSteps = {
      total: executionData.stepCount || 0,
      passed: executionData.passedCount || 0,
      failed: executionData.failedCount || 0,
      failedNames: failedSteps,
      allPassed: failedSteps.length === 0,
    };
    if (failedSteps.length > 0) {
      blockers.push(`failed_pipeline_steps: ${failedSteps.join(', ')}`);
    }
  }

  const decision = blockers.length === 0 ? 'GO' : 'NO_GO';

  return {
    decision,
    blockers,
    warnings,
    checks,
    thresholds,
    stabilityScore,
    evaluatedAt: new Date().toISOString(),
  };
}

// ─── Persist ─────────────────────────────────────────────────────────────────

/**
 * Avalia o gate e persiste o relatório.
 *
 * @param {object} [options]
 * @returns {object} Gate result
 */
function runAndPersistGate(options = {}) {
  ensureDir(REPORTS_DIR);

  const result = evaluateGate(options);

  // JSON report
  const jsonPath = path.join(REPORTS_DIR, 'release-gate.json');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  // Markdown report
  const md = [
    `# Release Gate — Decisão`,
    ``,
    `**Data:** ${result.evaluatedAt}`,
    `**Decisão:** ${result.decision === 'GO' ? '✅ GO — RELEASE APROVADO' : '❌ NO_GO — RELEASE BLOQUEADO'}`,
    `**Score de Estabilidade:** ${result.stabilityScore ?? 'N/A'}`,
    ``,
    result.blockers.length > 0
      ? `## Bloqueadores (${result.blockers.length})\n\n${result.blockers.map((b) => `- ❌ ${b}`).join('\n')}`
      : `## Sem Bloqueadores ✅`,
    ``,
    result.warnings.length > 0
      ? `## Avisos\n\n${result.warnings.map((w) => `- ⚠️ ${w}`).join('\n')}\n`
      : '',
    `## Checks Executados`,
    ``,
    `| Check | Status | Detalhe |`,
    `|---|---|---|`,
    ...Object.entries(result.checks).map(([k, v]) => {
      const status = v.passed !== false ? '✅' : '❌';
      const detail = v.score != null ? `score: ${v.score}` : v.activeFailures != null ? `failures: ${v.activeFailures}` : v.delta != null ? `delta: ${v.delta}` : JSON.stringify(v).slice(0, 80);
      return `| ${k} | ${status} | ${detail} |`;
    }),
    ``,
    `## Thresholds Aplicados`,
    ``,
    ...Object.entries(result.thresholds).map(([k, v]) => `- \`${k}\`: ${v}`),
  ].join('\n');

  fs.writeFileSync(path.join(REPORTS_DIR, 'release-gate.md'), md);

  return result;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const result = runAndPersistGate();
  console.log('\n' + '═'.repeat(60));
  console.log(`  RELEASE GATE: ${result.decision}`);
  if (result.blockers.length > 0) {
    console.log('  BLOQUEADORES:');
    result.blockers.forEach((b) => console.log(`    - ${b}`));
  }
  if (result.warnings.length > 0) {
    console.log('  AVISOS:');
    result.warnings.forEach((w) => console.log(`    ⚠ ${w}`));
  }
  console.log('  Stability Score:', result.stabilityScore ?? 'N/A');
  console.log('─'.repeat(60));
  console.log('  Reports: qa/reports/release-gate.json');
  console.log('═'.repeat(60) + '\n');

  if (result.decision === 'NO_GO') process.exitCode = 1;
}

module.exports = { evaluateGate, runAndPersistGate, THRESHOLDS };
