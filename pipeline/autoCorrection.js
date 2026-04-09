'use strict';

/**
 * pipeline/autoCorrection.js
 *
 * Auto-correção controlada — TAREFA 10 do RAP (Results Autonomous Platform).
 *
 * Fluxo:
 *   1. Lê o artefato de execução mais recente (qa/reports/execution.json)
 *   2. Executa o pipeline de learning: cluster → rank → suggest → plan
 *   3. Aplica patches em dry-run (RAP_LEARN_MODE=patch-controlled por padrão)
 *   4. Avalia promoção via promotionDecider (cada plano individualmente)
 *   5. Se RAP_AUTO_PROMOTE=1 AND todos os gates passam → marca como promovido
 *   6. Persiste qa/reports/auto-correction.json + auto-correction.md
 *
 * Feature flags:
 *   RAP_LEARN_MODE       = suggestion-only | patch-controlled (default: patch-controlled)
 *   RAP_AUTO_PROMOTE     = 0 | 1 (default: 0 — promoção manual)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPORTS_DIR = path.join(__dirname, '..', 'qa', 'reports');
const OUTPUT_JSON = path.join(REPORTS_DIR, 'auto-correction.json');
const OUTPUT_MD   = path.join(REPORTS_DIR, 'auto-correction.md');
const LEARN_VALIDATION_JSON = path.join(REPORTS_DIR, 'learn-validation.json');

// Learning subsystem
const { runLearningPipeline } = require('../qa/mesh/intelligence/learning/index');
const { decidePromotion }     = require('../qa/mesh/intelligence/learning/promotionDecider');

// Stability (para comparação before/after)
const stabilityEngine = (() => {
  try { return require('../qa/mesh/intelligence/stabilityEngine'); }
  catch (_) { return null; }
})();

// ─── helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readStabilityScore(artifact) {
  if (!artifact) return 0;
  return artifact?.snapshot?.global?.stabilityScore ?? artifact?.snapshot?.overallScore ?? artifact?.score ?? 0;
}

function ensureSymlink(targetPath, linkPath) {
  try {
    if (fs.existsSync(linkPath)) return;
    fs.symlinkSync(targetPath, linkPath, 'dir');
  } catch (_) {
    // fallback silencioso: sandbox continua sem o link se não for suportado
  }
}

function copyWorkspaceToSandbox() {
  const sandboxRoot = path.join(os.tmpdir(), 'r-agent2-learn-validation', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const excludedRoots = new Set([
    '.git',
    'node_modules',
    'logs',
    'data',
    'coverage',
    'dist',
    'artifacts',
    'remote-dumps',
    'remote-dumps2',
  ]);

  fs.mkdirSync(sandboxRoot, { recursive: true });

  for (const entry of fs.readdirSync(path.join(__dirname, '..'), { withFileTypes: true })) {
    if (excludedRoots.has(entry.name)) continue;
    const src = path.join(__dirname, '..', entry.name);
    const dest = path.join(sandboxRoot, entry.name);
    fs.cpSync(src, dest, {
      recursive: true,
      force: true,
      filter: (sourcePath) => !sourcePath.includes(`${path.sep}node_modules${path.sep}`),
    });
  }

  const rootNodeModules = path.join(__dirname, '..', 'node_modules');
  if (fs.existsSync(rootNodeModules)) {
    ensureSymlink(rootNodeModules, path.join(sandboxRoot, 'node_modules'));
  }

  const frontendNodeModules = path.join(__dirname, '..', 'frontend', 'node_modules');
  if (fs.existsSync(frontendNodeModules)) {
    fs.mkdirSync(path.join(sandboxRoot, 'frontend'), { recursive: true });
    ensureSymlink(frontendNodeModules, path.join(sandboxRoot, 'frontend', 'node_modules'));
  }

  return sandboxRoot;
}

function readGateDecision(artifact) {
  return artifact?.decision || artifact?.gateDecision || 'NO_GO';
}

function buildLearnValidationSummary({ sandboxPath, before, after, exitCode, skipped = false, reason = null }) {
  const regression = before.score !== null && after.score !== null ? after.score < before.score : null;
  const scoreDelta = before.score !== null && after.score !== null ? Number((after.score - before.score).toFixed(2)) : null;
  return {
    generatedAt: new Date().toISOString(),
    sandboxPath,
    skipped,
    reason,
    before,
    after,
    comparison: {
      scoreDelta,
      regression,
      failureResolved: before.gate === 'NO_GO' && after.gate === 'GO',
      replayMaintained: after.replayPassed === true,
    },
    pipeline: {
      exitCode,
      success: exitCode === 0,
    },
  };
}

function runSandboxValidation(opts = {}) {
  const before = {
    score: readStabilityScore(opts.stabilityBefore),
    gate: readGateDecision(opts.gateBefore),
    replayPassed: opts.executionData?.replayCriticalPassed ?? null,
  };

  if ((opts.fixPlans?.plans || []).length === 0) {
    const report = buildLearnValidationSummary({
      sandboxPath: null,
      before,
      after: before,
      exitCode: 0,
      skipped: true,
      reason: 'no_fix_plans_generated',
    });
    fs.writeFileSync(LEARN_VALIDATION_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');
    return report;
  }

  const sandboxPath = copyWorkspaceToSandbox();
  const child = spawnSync('node', ['pipeline/runFullValidation.js'], {
    cwd: sandboxPath,
    encoding: 'utf8',
    env: {
      ...process.env,
      RAP_SKIP_AUTOCORRECTION: '1',
      RAP_LEARN_VALIDATION_CHILD: '1',
      RUNNING_IN_PIPELINE: '1',
      PIPELINE_BYPASS: '1',
    },
  });

  const stabilityAfter = readJSON(path.join(sandboxPath, 'qa', 'reports', 'stability.json'));
  const gateAfter = readJSON(path.join(sandboxPath, 'qa', 'reports', 'release-gate.json'));
  const executionAfter = readJSON(path.join(sandboxPath, 'qa', 'reports', 'execution.json'));

  const after = {
    score: readStabilityScore(stabilityAfter),
    gate: readGateDecision(gateAfter),
    replayPassed: executionAfter?.replayCriticalPassed ?? ((executionAfter?.steps || []).find((step) => step.name === 'replay-critical') || {}).success ?? null,
  };

  const report = buildLearnValidationSummary({
    sandboxPath,
    before,
    after,
    exitCode: child.status ?? 1,
  });
  report.stdoutTail = String(child.stdout || '').slice(-4000);
  report.stderrTail = String(child.stderr || '').slice(-4000);

  fs.writeFileSync(LEARN_VALIDATION_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

// ─── core logic ───────────────────────────────────────────────────────────────

/**
 * Executa o ciclo completo de auto-correção.
 *
 * @param {object} [opts]
 * @param {object} [opts.executionData]   - Override do artefato de execução
 * @param {object} [opts.stabilityBefore] - Override do artefato de estabilidade antes
 * @param {boolean} [opts.dryRunOnly]     - Forçar dry-run sem promoção
 * @returns {object} Relatório completo da auto-correção
 */
function runAutoCorrection(opts = {}) {
  const learnMode = process.env.RAP_LEARN_MODE || 'patch-controlled';
  const autoPromote = (process.env.RAP_AUTO_PROMOTE === '1') && !(opts.dryRunOnly);

  // ── 1. Carregar artefato de execução ──────────────────────────────────────
  const executionData = opts.executionData
    || readJSON(path.join(REPORTS_DIR, 'execution.json'))
    || { steps: [], generatedAt: new Date().toISOString(), success: false };

  // ── 2. Estabilidade ANTES ─────────────────────────────────────────────────
  const stabilityArtifactBefore = opts.stabilityBefore
    || readJSON(path.join(REPORTS_DIR, 'stability.json'))
    || { score: 0 };
  const scoreBefore = readStabilityScore(stabilityArtifactBefore);

  // ── 3. Executar pipeline de learning ──────────────────────────────────────
  const history = readJSON(
    path.join(__dirname, '..', 'qa', 'mesh', 'intelligence', 'learning', 'learningMemory.json')
  ) || [];

  const learningResult = runLearningPipeline(executionData, Array.isArray(history) ? history : []);
  const { fixPlans, patchExecutions } = learningResult;

  // ── 4. Avaliar promoção por plano ─────────────────────────────────────────
  // Após dry-run não temos validação real; usamos heurística conservadora:
  // - failureResolved: false (não sabemos sem re-execução)
  // - criticalTestsPassed: true apenas se executionData.success === true
  // - criticalReplayPassed: true apenas se executionData.steps existem e todos passaram
  // - stabilityAfter: scoreBefore (não mudou — dry-run não altera código)
  // - releaseGateHealthy: false em dry-run

  const plans = fixPlans?.plans || [];
  const promotionResults = plans.map((plan) => {
    return decidePromotion({
      plan,
      validation: {
        failureResolved: false,         // dry-run não resolve falhas reais
        criticalTestsPassed: !!executionData.success,
        criticalReplayPassed: (executionData.steps || []).every((s) => s.success),
      },
      stabilityBefore: scoreBefore,
      stabilityAfter: scoreBefore,      // dry-run não muda a estabilidade
      releaseGateHealthy: false,        // só passa quando pipeline real roda
    });
  });

  const promotedPlans   = promotionResults.filter((r) => r.approved && autoPromote);
  const rejectedPlans   = promotionResults.filter((r) => !r.approved || !autoPromote);
  const totalPlans      = plans.length;
  const learnValidation = runSandboxValidation({
    fixPlans,
    executionData,
    stabilityBefore: stabilityArtifactBefore,
    gateBefore: opts.gateBefore,
  });

  // ── 5. Montar relatório ───────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    learnMode,
    autoPromoteEnabled: autoPromote,
    dryRun: !autoPromote,
    summary: {
      totalFailureClusters: learningResult.clustered?.clusters?.length ?? 0,
      totalPlans,
      patchExecutions: patchExecutions?.totalExecutions ?? 0,
      promotedPlans: promotedPlans.length,
      rejectedPlans: rejectedPlans.length,
      scoreBefore,
      scoreAfter: learnValidation?.after?.score ?? scoreBefore,
    },
    learning: {
      normalized:   learningResult.normalized?.total ?? 0,
      clustered:    learningResult.clustered?.clusters?.length ?? 0,
      ranked:       learningResult.ranked?.ranked?.length ?? 0,
      suggestions:  learningResult.suggestions?.suggestions?.length ?? 0,
      fixPlans:     totalPlans,
    },
    promotionResults,
    patchExecutions: patchExecutions?.executions ?? [],
    learnValidation,
    featureFlags: {
      RAP_LEARN_MODE:    learnMode,
      RAP_AUTO_PROMOTE:  autoPromote ? '1' : '0',
    },
    notes: autoPromote
      ? 'Promoção automática ativa. Planos aprovados foram marcados como promovidos.'
      : 'Modo dry-run. Nenhuma alteração automática foi aplicada. Defina RAP_AUTO_PROMOTE=1 para habilitar promoção.',
  };

  // ── 6. Persistir relatórios ───────────────────────────────────────────────
  ensureDir(REPORTS_DIR);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(OUTPUT_MD, generateMarkdown(report), 'utf8');

  return report;
}

// ─── markdown report ──────────────────────────────────────────────────────────

function generateMarkdown(report) {
  const { summary, learning, promotionResults, featureFlags, notes, dryRun } = report;
  const lines = [
    '# Auto-Correção Controlada — RAP',
    '',
    `**Gerado em:** ${report.generatedAt}`,
    `**Modo:** ${report.learnMode}`,
    `**Dry-run:** ${dryRun ? 'SIM (nenhuma alteração aplicada)' : 'NÃO (promoção automática ativa)'}`,
    '',
    '## Resumo',
    '',
    `| Métrica | Valor |`,
    `|---|---|`,
    `| Clusters de falha | ${summary.totalFailureClusters} |`,
    `| Planos gerados | ${summary.totalPlans} |`,
    `| Patch executions | ${summary.patchExecutions} |`,
    `| Planos promovidos | ${summary.promotedPlans} |`,
    `| Planos rejeitados | ${summary.rejectedPlans} |`,
    `| Stability score before | ${summary.scoreBefore} |`,
    `| Stability score after | ${summary.scoreAfter} |`,
    '',
    '## Pipeline de Learning',
    '',
    `| Etapa | Resultado |`,
    `|---|---|`,
    `| Falhas normalizadas | ${learning.normalized} |`,
    `| Clusters | ${learning.clustered} |`,
    `| Ranked | ${learning.ranked} |`,
    `| Sugestões | ${learning.suggestions} |`,
    `| Planos de fix | ${learning.fixPlans} |`,
    '',
  ];

  if (promotionResults.length > 0) {
    lines.push('## Decisões de Promoção', '');
    promotionResults.forEach((r) => {
      lines.push(`### ${r.failureSignature}`);
      lines.push(`**Decisão:** ${r.decision.toUpperCase()}`);
      lines.push(`**Motivo:** ${r.reason}`);
      lines.push('**Gates:**');
      Object.entries(r.checks).forEach(([k, v]) => {
        lines.push(`- ${v ? '✓' : '✗'} ${k}`);
      });
      lines.push('');
    });
  } else {
    lines.push('## Decisões de Promoção', '', '_Nenhum plano gerado nesta execução._', '');
  }

  lines.push('## Feature Flags', '');
  lines.push(`| Flag | Valor |`);
  lines.push(`|---|---|`);
  Object.entries(featureFlags).forEach(([k, v]) => lines.push(`| \`${k}\` | \`${v}\` |`));

  lines.push('', '## Notas', '', notes);

  return lines.join('\n') + '\n';
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  console.log('\n' + '═'.repeat(60));
  console.log('  AUTO-CORREÇÃO CONTROLADA (TAREFA 10)');
  console.log('═'.repeat(60));

  const report = runAutoCorrection({ dryRunOnly: process.env.RAP_AUTO_PROMOTE !== '1' });

  const s = report.summary;
  console.log(`\nClusters:     ${s.totalFailureClusters}`);
  console.log(`Planos:       ${s.totalPlans}`);
  console.log(`Promovidos:   ${s.promotedPlans}`);
  console.log(`Rejeitados:   ${s.rejectedPlans}`);
  console.log(`Dry-run:      ${report.dryRun}`);
  console.log(`\nReports: ${OUTPUT_JSON}`);
  console.log('═'.repeat(60));
}

module.exports = { runAutoCorrection };
