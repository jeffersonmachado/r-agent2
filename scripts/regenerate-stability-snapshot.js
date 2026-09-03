'use strict';

/**
 * regenerate-stability-snapshot — one-shot (2026-09-03).
 *
 * Regenera qa/mesh/intelligence/stabilitySnapshot.json a partir da execução
 * canônica do QA Mesh registrada em qa-mesh/meshHistory/, usando o engine rico
 * restaurado (qa/mesh/intelligence/stabilityEngine.js). Também persiste o ponto
 * no histórico (stabilityHistory) para alimentar a série temporal da UI.
 *
 * Uso: node scripts/regenerate-stability-snapshot.js [executionId]
 *   Sem argumento, usa a execução canônica mais recente (isCanonicalExecution)
 *   do meshHistory; fallback para a execução apontada por go-no-go-report.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MESH_HISTORY_DIR = path.join(ROOT, 'qa-mesh', 'meshHistory');
const GO_NO_GO_PATH = path.join(ROOT, 'qa-mesh', 'go-no-go-report.json');

const { generateStabilitySnapshot, SNAPSHOT_PATH } = require('../qa/mesh/intelligence/stabilityEngine');
const { persistStabilitySnapshot } = require('../qa/mesh/intelligence/stabilityHistory');

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
    console.error('[regenerate-stability] Nenhuma execução canônica encontrada.');
    process.exit(1);
  }
  const filePath = path.join(MESH_HISTORY_DIR, `${executionId}.json`);
  const execution = safeReadJson(filePath);
  if (!execution) {
    console.error(`[regenerate-stability] Execução não encontrada: ${filePath}`);
    process.exit(1);
  }

  const { snapshot, outputPath } = generateStabilitySnapshot({ execution });
  persistStabilitySnapshot(snapshot);

  const verticals = (snapshot.verticals || []).map((v) => `${v.name}:${v.scenarios} cenários, score ${v.score}, ${v.readiness}`);
  console.log(`[regenerate-stability] execução: ${executionId}`);
  console.log(`[regenerate-stability] snapshot gravado em: ${outputPath || SNAPSHOT_PATH}`);
  console.log(`[regenerate-stability] global.stabilityScore: ${snapshot.global?.stabilityScore}`);
  console.log(`[regenerate-stability] global.releaseReadiness: ${snapshot.global?.releaseReadiness}`);
  console.log(`[regenerate-stability] verticals: ${verticals.join(' | ')}`);
}

main();
