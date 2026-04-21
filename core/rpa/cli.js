#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { isInPipeline } = require('../../pipeline/guard');

const ROOT = path.join(__dirname, '..', '..');

const COMMANDS = {
  suite: {
    target: ['node', ['tools/rpa/run-all.js']],
    requiresPipeline: true,
    label: 'rpa-suite',
  },
  business: {
    target: ['node', ['tests/rpa/business/run.js']],
    requiresPipeline: true,
    label: 'business-qa',
  },
  seed: {
    target: ['node', ['tests/rpa/seedPlatformRPA.js']],
    requiresPipeline: false,
    label: 'rpa-seed',
  },
  screens: {
    target: ['node', ['tests/rpa/runScreenCatalogRPA.js']],
    requiresPipeline: false,
    label: 'rpa-screens',
  },
  'seed-complete': {
    target: ['node', ['tests/rpa/seedPlatformCompleto.js']],
    requiresPipeline: false,
    label: 'rpa-seed-complete',
  },
  'seed-debug': {
    target: ['node', ['tests/rpa/seedPlatformDebug.js']],
    requiresPipeline: false,
    label: 'rpa-seed-debug',
  },
  'seed-replay': {
    target: ['node', ['tests/rpa/seedCompletoComReplay.js']],
    requiresPipeline: false,
    label: 'rpa-seed-replay',
  },
  'replay-execute': {
    target: ['node', ['tests/rpa/executarSeedComReplay.js']],
    requiresPipeline: false,
    label: 'rpa-replay-execute',
  },
  'seed-record': {
    target: ['node', ['tests/rpa/seedPlatformGravar.js']],
    requiresPipeline: false,
    label: 'rpa-seed-record',
  },
  'replay-view': {
    target: ['node', ['tests/rpa/verReplaySeed.js']],
    requiresPipeline: false,
    label: 'rpa-replay-view',
  },
  'replay-generate': {
    target: ['node', ['tests/rpa/gerarReplayDetalhado.js']],
    requiresPipeline: false,
    label: 'rpa-replay-generate',
  },
  demo: {
    target: ['node', ['tests/rpa/demo.js']],
    requiresPipeline: false,
    label: 'rpa-demo',
  },
  record: {
    target: ['node', ['tests/rpa/gravar-seed-rpa.js']],
    requiresPipeline: false,
    label: 'rpa-record',
  },
};

function resolveArgs(argv) {
  const [, , command = 'suite', ...rest] = argv;
  return { command, rest };
}

function ensureExecutionMode(commandConfig) {
  if (!commandConfig.requiresPipeline) return;
  if (process.env.PIPELINE_BYPASS === '1') return;
  if (isInPipeline()) return;

  throw new Error(
    `[core/rpa/cli] "${commandConfig.label}" exige o pipeline oficial.\n`
    + 'Execute: npm run pipeline\n'
    + 'Para uso local explicito: PIPELINE_BYPASS=1 <comando>'
  );
}

function main(argv = process.argv) {
  const { command, rest } = resolveArgs(argv);
  const commandConfig = COMMANDS[command];

  if (!commandConfig) {
    console.error(`[core/rpa/cli] comando desconhecido: ${command}`);
    console.error(`Comandos: ${Object.keys(COMMANDS).join(', ')}`);
    process.exit(1);
  }

  ensureExecutionMode(commandConfig);

  const [executable, baseArgs] = commandConfig.target;
  const env = {
    ...process.env,
    LEGACY_RPA_ENTRYPOINT_ALLOWED: '1',
  };

  if (commandConfig.requiresPipeline && isInPipeline()) {
    env.RUNNING_IN_PIPELINE = '1';
  }

  const result = spawnSync(executable, [...baseArgs, ...rest], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  });

  if (typeof result.status === 'number') {
    process.exit(result.status);
  }

  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
};