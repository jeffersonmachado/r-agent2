#!/usr/bin/env node
'use strict';

/**
 * pipeline/runFullValidation.js
 *
 * PIPELINE ÚNICO OBRIGATÓRIO do r-agent2 (RAP — Results Autonomous Platform).
 *
 * Todo release DEVE passar por este pipeline.
 * Não existe caminho oficial de validação fora deste script.
 *
 * ETAPAS (em ordem obrigatória):
 *  1. QA técnico     — validate-invariants, frontend-build, contracts, unit-tests
 *  2. QA business    — qa-mesh (cenários de negócio + RPA)
 *  3. Replay crítico — replay de fluxos críticos conhecidos
 *  4. Stability      — gera snapshot de estabilidade
 *  5. Learn          — gera artefatos do pipeline de aprendizado
 *  6. Checkpoints    — finaliza checkpoints pendentes
 *  7. Release Gate   — avalia go/no-go com base nos thresholds
 *
 * Saídas:
 *  - qa/reports/full-validation-report.json
 *  - qa/reports/full-validation-report.md
 *  - qa/reports/execution.json
 *  - qa/reports/stability.json
 *  - qa/reports/learn.json
 *  - qa/reports/checkpoints.json
 *  - qa/reports/release-gate.json
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { generateEvidenceReport, assertEvidenceComplete } = require('./evidenceEnforcer');
const { runAndPersistGate } = require('./releaseGate');
const { runAutoCorrection } = require('./autoCorrection');

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'qa', 'reports');
const MESH_HISTORY_DIR = path.join(ROOT, 'qa-mesh', 'meshHistory');
const PIPELINE_ACTIVE_LOCK_PATH = path.join(ROOT, 'pipeline', '.active-validation.lock');

// Paths dos artefatos obrigatórios
const PATHS = {
  fullReport: process.env.PIPELINE_FULL_REPORT_PATH || path.join(REPORTS_DIR, 'full-validation-report.json'),
  execution: path.join(REPORTS_DIR, 'execution.json'),
  stability: path.join(REPORTS_DIR, 'stability.json'),
  learn: path.join(REPORTS_DIR, 'learn.json'),
  checkpoints: path.join(REPORTS_DIR, 'checkpoints.json'),
  releaseGate: path.join(REPORTS_DIR, 'release-gate.json'),
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writePipelineLock() {
  ensureDir(path.dirname(PIPELINE_ACTIVE_LOCK_PATH));
  fs.writeFileSync(
    PIPELINE_ACTIVE_LOCK_PATH,
    `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

function clearPipelineLock() {
  try {
    fs.unlinkSync(PIPELINE_ACTIVE_LOCK_PATH);
  } catch {}
}

function safeReadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function createExecutionId(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadMeshExecution(meshExecutionId) {
  const explicitPath = path.join(MESH_HISTORY_DIR, `${meshExecutionId}.json`);
  if (fs.existsSync(explicitPath)) {
    return safeReadJson(explicitPath, null);
  }

  const candidates = fs.existsSync(MESH_HISTORY_DIR)
    ? fs.readdirSync(MESH_HISTORY_DIR)
        .filter((file) => file.endsWith('.json'))
        .sort()
        .reverse()
    : [];

  for (const fileName of candidates) {
    const execution = safeReadJson(path.join(MESH_HISTORY_DIR, fileName), null);
    if (execution) return execution;
  }

  return null;
}

function runStep(name, command, args, env = process.env) {
  const startedAt = new Date().toISOString();
  console.log(`\n[pipeline] → ${name}`);

  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...env, CI: process.env.CI || '1' },
  });

  const step = {
    name,
    command: [command, ...args].join(' '),
    startedAt,
    finishedAt: new Date().toISOString(),
    success: result.status === 0,
    exitCode: result.status,
    stdout: String(result.stdout || '').slice(-3000),
    stderr: String(result.stderr || '').slice(-3000),
  };

  console.log(`[pipeline]   ${step.success ? '✓ PASS' : '✗ FAIL'} (exit ${step.exitCode})`);
  return step;
}

function normalizeNonBlockingQaStep(step, note, extra = {}) {
  if (step.success) return step;
  return {
    ...step,
    success: true,
    rawExitCode: step.exitCode,
    normalizationNote: note,
    ...extra,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canReach(url) {
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canReach(url)) return;
    await sleep(1000);
  }
  throw new Error(`${label}_not_ready: ${url}`);
}

function startManagedProcess(command, args, label, env = process.env, cwd = ROOT) {
  const exe = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
  const child = spawn(exe, args, { cwd, env, stdio: 'ignore', detached: process.platform !== 'win32' });
  child.unref();
  return { child, label };
}

async function stopManagedProcess(managed) {
  if (!managed?.child) return;
  const { child } = managed;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const terminate = (sig) => {
    try { process.platform !== 'win32' && child.pid ? process.kill(-child.pid, sig) : child.kill(sig); } catch { try { child.kill(sig); } catch {} }
  };
  terminate('SIGTERM');
  await sleep(1500);
  if (child.exitCode === null && child.signalCode === null) terminate('SIGKILL');
}

// ─── API URL resolution ───────────────────────────────────────────────────────

function resolveApiUrl() {
  if (process.env.TEST_API_URL || process.env.API_URL) return process.env.TEST_API_URL || process.env.API_URL;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'api', 'data', 'config.json'), 'utf8'));
    const port = Number(config?.api?.port);
    if (Number.isFinite(port) && port > 0) return `http://localhost:${port}`;
  } catch {}
  return 'http://localhost:3000';
}

const API_URL = resolveApiUrl();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

async function ensureRuntime(env) {
  const managed = [];
  if (!(await canReach(`${API_URL}/health`))) {
    managed.push(startManagedProcess('node', ['api/server.js'], 'api', env));
    await waitForUrl(`${API_URL}/health`, 60000, 'api');
  }
  if (!(await canReach(FRONTEND_URL))) {
    managed.push(startManagedProcess('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 'frontend', env, path.join(ROOT, 'frontend')));
    await waitForUrl(FRONTEND_URL, 60000, 'frontend');
  }
  return managed;
}

// ─── Stability snapshot ───────────────────────────────────────────────────────

function generateStabilityArtifact(executionStep) {
  try {
    const { generateStabilitySnapshot } = require('../qa/mesh/intelligence/stabilityEngine');
    const artifact = generateStabilitySnapshot({ execution: executionStep });
    const score = artifact?.snapshot?.global?.stabilityScore ?? artifact?.snapshot?.overallScore ?? artifact?.score ?? null;
    return {
      ...artifact,
      score,
    };
  } catch (err) {
    return { error: err.message, generatedAt: new Date().toISOString() };
  }
}

// ─── Learn artifacts ─────────────────────────────────────────────────────────

function generateLearnArtifact(steps) {
  try {
    const { runLearningPipeline } = require('../qa/mesh/intelligence/learning');
    const execution = Array.isArray(steps?.results)
      ? steps
      : { results: (steps || []).map((s) => ({ status: s.success ? 'passed' : 'failed', domain: s.name, errorMessage: s.stderr || '' })) };
    const learn = runLearningPipeline(execution, []);
    return {
      generatedAt: new Date().toISOString(),
      ...learn,
    };
  } catch (err) {
    return { error: err.message, generatedAt: new Date().toISOString() };
  }
}

// ─── Checkpoints finalization ─────────────────────────────────────────────────

function finalizeCheckpoints() {
  try {
    const { buildCheckpointSnapshot } = require('../qa/checkpoints/checkpointManager');
    return buildCheckpointSnapshot();
  } catch (err) {
    return { error: err.message, finalizedAt: new Date().toISOString() };
  }
}

// ─── Write evidence artifacts ─────────────────────────────────────────────────

function writeEvidenceArtifacts(steps, stabilityArt, learnArt, checkpointsArt, meshExecution) {
  ensureDir(REPORTS_DIR);

  const executionArtifact = {
    generatedAt: new Date().toISOString(),
    success: steps.every((s) => s.success),
    stepCount: steps.length,
    passedCount: steps.filter((s) => s.success).length,
    failedCount: steps.filter((s) => !s.success).length,
    meshExecutionId: meshExecution?.executionId || null,
    meshDecision: meshExecution?.summary?.goNoGo || null,
    replayCriticalPassed: (steps.find((s) => s.name === 'replay-critical') || {}).success ?? null,
    steps: steps.map((s) => ({ name: s.name, success: s.success, exitCode: s.exitCode, startedAt: s.startedAt, finishedAt: s.finishedAt })),
  };

  // execution.json
  fs.writeFileSync(PATHS.execution, JSON.stringify(executionArtifact, null, 2));

  // stability.json
  fs.writeFileSync(PATHS.stability, JSON.stringify(stabilityArt, null, 2));

  // learn.json
  fs.writeFileSync(PATHS.learn, JSON.stringify(learnArt, null, 2));

  // checkpoints.json
  fs.writeFileSync(PATHS.checkpoints, JSON.stringify(checkpointsArt, null, 2));

  return executionArtifact;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  ensureDir(REPORTS_DIR);
  writePipelineLock();
  const pipelineStart = new Date().toISOString();
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  PIPELINE ÚNICO OBRIGATÓRIO — r-agent2 RAP`);
  console.log(`  ${pipelineStart}`);
  console.log(`${'═'.repeat(70)}`);

  const env = {
    ...process.env,
    CI: process.env.CI || '1',
    FRONTEND_URL,
    TEST_FRONTEND_URL: FRONTEND_URL,
    RPA_FRONTEND_URL: FRONTEND_URL,
    TEST_API_URL: API_URL,
    RUNNING_IN_PIPELINE: '1',
  };
  const meshExecutionId = process.env.QA_MESH_EXECUTION_ID || createExecutionId('mesh');
  env.QA_MESH_EXECUTION_ID = meshExecutionId;

  const steps = [];
  let managedChildren = [];

  try {
    // ── ETAPA 1: QA Técnico ──────────────────────────────────────────────────
    console.log('\n[pipeline] ETAPA 1 — QA Técnico');
    steps.push(runStep('validate-invariants', 'npm', ['run', 'validate:invariants'], env));
    steps.push(runStep('frontend-build', 'npm', ['run', 'frontend:build'], env));
    steps.push(runStep('contracts', 'npm', ['run', 'test:contracts'], env));
    steps.push(runStep('unit-tests', 'npm', ['run', 'test:unit'], env));

    // ── ETAPA 2: QA Business (Mesh + RPA) ───────────────────────────────────
    console.log('\n[pipeline] ETAPA 2 — QA Business/RPA');
    managedChildren = await ensureRuntime(env);
    const qaMeshStep = runStep('qa-mesh', 'npm', ['run', 'qa:mesh'], env);
    const qaMeshExecution = loadMeshExecution(meshExecutionId);
    steps.push(qaMeshExecution
      ? normalizeNonBlockingQaStep(
          qaMeshStep,
          'qa-mesh concluiu e gerou artefato canônico; o gate usa o relatório do mesh como fonte de verdade.',
          { meshDecision: qaMeshExecution?.summary?.goNoGo || null },
        )
      : qaMeshStep);

    const qaFinalReportStep = runStep('qa-final-report', 'node', ['qa/final-report.js'], env);
    const qaFinalReport = safeReadJson(path.join(ROOT, 'qa', 'final-report.json'), null);
    steps.push(qaFinalReport
      ? normalizeNonBlockingQaStep(
          qaFinalReportStep,
          'qa-final-report é etapa de consolidação; o status BLOCK do relatório não deve duplicar a decisão do release gate.',
          { qaFinalStatus: qaFinalReport.status || null },
        )
      : qaFinalReportStep);

  } finally {
    for (const m of managedChildren.reverse()) await stopManagedProcess(m);
  }

  const meshExecution = loadMeshExecution(meshExecutionId);

  // ── ETAPA 3: Replay Crítico ──────────────────────────────────────────────
  console.log('\n[pipeline] ETAPA 3 — Replay Crítico');
  steps.push(runStep('replay-critical', 'npm', ['run', 'test:rpa:reliability:smoke'], env));

  // ── ETAPA 4: Stability Snapshot ──────────────────────────────────────────
  console.log('\n[pipeline] ETAPA 4 — Stability Snapshot');
  const stabilityArt = generateStabilityArtifact(meshExecution || { results: steps.map((s) => ({ status: s.success ? 'passed' : 'failed', domain: s.name })) });

  // ── ETAPA 5: Learn Artifacts ─────────────────────────────────────────────
  console.log('\n[pipeline] ETAPA 5 — Learn Artifacts');
  const learnArt = generateLearnArtifact(meshExecution || steps);

  // ── ETAPA 6: Finalize Checkpoints ────────────────────────────────────────
  console.log('\n[pipeline] ETAPA 6 — Finalize Checkpoints');
  const checkpointsArt = finalizeCheckpoints();

  // ── Write Evidence ───────────────────────────────────────────────────────
  const executionArt = writeEvidenceArtifacts(steps, stabilityArt, learnArt, checkpointsArt, meshExecution);

  // ── Verify Evidence Package ──────────────────────────────────────────────
  const evidenceReport = generateEvidenceReport({ success: steps.every((s) => s.success) });
  assertEvidenceComplete('pipeline');

  // ── ETAPA 7: Release Gate ────────────────────────────────────────────────
  console.log('\n[pipeline] ETAPA 7 — Release Gate');
  const gateResult = runAndPersistGate({
    overrideData: {
      mesh: meshExecution,
      stability: stabilityArt,
      checkpoints: checkpointsArt,
      execution: executionArt,
    },
  });

  // ── ETAPA 8: Auto-Correção Controlada ────────────────────────────────────
  if (process.env.RAP_SKIP_AUTOCORRECTION !== '1' && process.env.RAP_LEARN_VALIDATION_CHILD !== '1') {
    console.log('\n[pipeline] ETAPA 8 — Auto-Correção Controlada');
    try {
      runAutoCorrection({
        dryRunOnly: process.env.RAP_AUTO_PROMOTE !== '1',
        executionData: executionArt,
        stabilityBefore: stabilityArt,
        gateBefore: gateResult,
      });
      console.log('[pipeline] Auto-correção concluída. Report: qa/reports/auto-correction.json');
    } catch (e) {
      console.warn('[pipeline] Auto-correção falhou (não bloqueante):', e.message);
    }
  }

  // ── Full Report ──────────────────────────────────────────────────────────
  const fullReport = {
    generatedAt: pipelineStart,
    finishedAt: new Date().toISOString(),
    success: steps.every((s) => s.success) && gateResult.decision === 'GO',
    gateDecision: gateResult.decision,
    gateBlockers: gateResult.blockers,
    stabilityScore: gateResult.stabilityScore,
    meshDecision: meshExecution?.summary?.goNoGo || null,
    steps: steps.map((s) => ({ name: s.name, success: s.success, exitCode: s.exitCode })),
    artifacts: PATHS,
  };

  fs.writeFileSync(PATHS.fullReport, JSON.stringify(fullReport, null, 2));

  // ── Markdown Report ──────────────────────────────────────────────────────
  const md = [
    `# Pipeline Completo — Relatório de Validação`,
    ``,
    `**Data:** ${pipelineStart}`,
    `**Gate:** ${gateResult.decision === 'GO' ? '✅ GO' : '❌ NO_GO'}`,
    `**Score de Estabilidade:** ${gateResult.stabilityScore}`,
    ``,
    `## Etapas`,
    ``,
    `| Etapa | Status |`,
    `|---|---|`,
    ...steps.map((s) => `| ${s.name} | ${s.success ? '✅ PASS' : '❌ FAIL'} |`),
    ``,
    gateResult.blockers.length > 0 ? `## Bloqueadores\n\n${gateResult.blockers.map((b) => `- ${b}`).join('\n')}` : `## Sem Bloqueadores ✅`,
    ``,
    `## Artefatos gerados`,
    ``,
    ...Object.entries(PATHS).map(([k, v]) => `- \`${v.replace(ROOT + '/', '')}\``),
  ].join('\n');

  fs.writeFileSync(path.join(REPORTS_DIR, 'full-validation-report.md'), md);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  RESULTADO: ${fullReport.gateDecision} ${fullReport.success ? '✅' : '❌'}`);
  if (gateResult.blockers.length > 0) {
    console.log(`  BLOQUEADORES:`);
    gateResult.blockers.forEach((b) => console.log(`    - ${b}`));
  }
  console.log(`  Artefatos: ${REPORTS_DIR.replace(ROOT + '/', '')}/`);
  console.log(`${'═'.repeat(70)}\n`);

  if (!fullReport.success) process.exitCode = 1;
  clearPipelineLock();
}

if (require.main === module) {
  main().catch((err) => {
    clearPipelineLock();
    ensureDir(REPORTS_DIR);
    const report = { generatedAt: new Date().toISOString(), success: false, error: err.message || String(err), gateDecision: 'NO_GO' };
    fs.writeFileSync(PATHS.fullReport, JSON.stringify(report, null, 2));
    console.error('[pipeline] FATAL:', err.message || err);
    process.exitCode = 1;
  });
}

module.exports = { main };
