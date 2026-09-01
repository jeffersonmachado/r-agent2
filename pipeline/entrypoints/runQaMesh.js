#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { isInPipeline } = require('../guard');

const ROOT = path.join(__dirname, '..', '..');

// Execução direta (CLI local ou disparada pela UI) é permitida: fora do
// pipeline oficial o mesh roda como execução manual NÃO canônica
// (executionOrigin=manual_run, sem promover outputs canônicos de governança).
// A promoção canônica (go-no-go-report, release-gate, histórico canônico)
// continua exclusiva do pipeline oficial (RUNNING_IN_PIPELINE=1) —
// ver qa-mesh/meshRunner.js (isCanonicalExecution).
if (!isInPipeline()) {
  console.warn(
    '[pipeline/entrypoints/runQaMesh] Execução direta: rodando como manual_run (não canônico).\n'
    + 'Para evidência canônica de governança: npm run pipeline'
  );
}

const result = spawnSync('node', ['qa-mesh/meshRunner.js', ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(isInPipeline() ? { RUNNING_IN_PIPELINE: '1' } : {}),
  },
});

process.exit(result.status ?? 1);