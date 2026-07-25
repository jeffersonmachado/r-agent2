#!/usr/bin/env node
'use strict';

/**
 * coverage-gate-snapshot.js
 *
 * Gera `config/coverage-gate-baseline.json`: snapshot versionado dos cenários
 * do QA Mesh (`qa-mesh/meshRegistry.json`, arquivo de runtime gitignored) com
 * o último status de execução por cenário (go-no-go-report + meshHistory).
 *
 * O validate-coverage-gate usa este snapshot quando o registry vivo não existe
 * no checkout (ex.: CI). Regere a cada release ou sempre que a execução
 * canônica do mesh mudar — o snapshot é o baseline de cobertura do pipeline.
 */

const fs = require('fs');
const path = require('path');
const { buildExecutions, MESH_REGISTRY_PATH, SNAPSHOT_PATH } = require('./validate-coverage-gate');

function main() {
  if (!fs.existsSync(MESH_REGISTRY_PATH)) {
    console.error(`[coverage-gate:snapshot] registry vivo ausente: ${MESH_REGISTRY_PATH}`);
    process.exit(1);
  }
  const scenarios = JSON.parse(fs.readFileSync(MESH_REGISTRY_PATH, 'utf8'));
  const executions = buildExecutions(scenarios);
  const snapshot = {
    generatedAt: new Date().toISOString(),
    scenarios,
    executions,
  };
  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`[coverage-gate:snapshot] scenarios=${scenarios.length} executions=${executions.length}`);
  console.log(`[coverage-gate:snapshot] gravado em ${SNAPSHOT_PATH}`);
}

main();
