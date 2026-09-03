'use strict';

/**
 * regenerate-learning-artifacts — one-shot (2026-09-03).
 *
 * Regenera os artefatos do learning pipeline rico (restaurado do commit
 * 15ef94d6^) em qa/mesh/intelligence/learning/ — failures.normalized.json,
 * failures.clustered.json, failures.ranked.json, fixSuggestions.json,
 * fixPlans.json, validationPlans.json, patchExecutions.json e
 * learningMemory.json — a partir da execução canônica do QA Mesh registrada
 * em qa-mesh/meshHistory/, alimentando os endpoints /qa/learn/* consumidos
 * pela StabilityPage.
 *
 * Uso: node scripts/regenerate-learning-artifacts.js [executionId]
 *   Sem argumento, usa a execução canônica mais recente (isCanonicalExecution)
 *   do meshHistory; fallback para a execução apontada por go-no-go-report.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MESH_HISTORY_DIR = path.join(ROOT, 'qa-mesh', 'meshHistory');
const GO_NO_GO_PATH = path.join(ROOT, 'qa-mesh', 'go-no-go-report.json');

const { runLearningPipeline } = require('../qa/mesh/intelligence/learning');

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function resolveExecutionId(arg) {
  if (arg) return arg;
  const files = fs.readdirSync(MESH_HISTORY_DIR).filter((f) => f.endsWith('.json')).sort().reverse();
  for (const file of files) {
    const data = safeReadJson(path.join(MESH_HISTORY_DIR, file));
    if (data && data.isCanonicalExecution === true && data.executionOrigin === 'pipeline') {
      return data.executionId;
    }
  }
  const goNoGo = safeReadJson(GO_NO_GO_PATH);
  return goNoGo?.executionId || null;
}

function main() {
  const executionId = resolveExecutionId(process.argv[2]);
  if (!executionId) {
    console.error('Nenhuma execução canônica encontrada em qa-mesh/meshHistory/.');
    process.exit(1);
  }

  const execution = safeReadJson(path.join(MESH_HISTORY_DIR, `${executionId}.json`));
  if (!execution) {
    console.error(`Execução ${executionId} não encontrada em qa-mesh/meshHistory/.`);
    process.exit(1);
  }

  const priorHistory = fs.readdirSync(MESH_HISTORY_DIR)
    .filter((f) => f.endsWith('.json') && f !== `${executionId}.json`)
    .sort()
    .map((f) => safeReadJson(path.join(MESH_HISTORY_DIR, f)))
    .filter((data) => data && data.isCanonicalExecution === true);

  const result = runLearningPipeline(execution, priorHistory);

  console.log(JSON.stringify({
    executionId,
    priorRuns: priorHistory.length,
    normalized: result.normalized.total,
    clusters: result.clustered.totalClusters,
    ranked: result.ranked.totalRanked,
    suggestions: result.suggestions.totalSuggestions,
    fixPlans: result.fixPlans.totalPlans,
    patchMode: result.patchExecutions.mode,
    memoryStats: result.memory.stats,
  }, null, 2));
}

main();
