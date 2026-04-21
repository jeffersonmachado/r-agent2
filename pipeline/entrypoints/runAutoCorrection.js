#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { isInPipeline } = require('../guard');

const ROOT = path.join(__dirname, '..', '..');

if (process.env.PIPELINE_BYPASS !== '1' && !isInPipeline()) {
  console.error(
    '[pipeline/entrypoints/runAutoCorrection] pipeline:autocorrect exige execução via npm run pipeline.\n'
    + 'Para uso local explicito: PIPELINE_BYPASS=1 npm run pipeline:autocorrect'
  );
  process.exit(1);
}

const result = spawnSync('node', ['pipeline/autoCorrection.js', ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(isInPipeline() ? { RUNNING_IN_PIPELINE: '1' } : {}),
  },
});

process.exit(result.status ?? 1);