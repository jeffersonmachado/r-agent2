#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function run(command, label) {
  // eslint-disable-next-line no-console
  console.log(`[system:bootstrap] ${label}`);
  execSync(command, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

function main() {
  const args = process.argv.slice(2).map((arg) => `'${String(arg).replace(/'/g, "'\\''")}'`).join(' ');
  const command = args ? `bash ./scripts/bootstrap/official.sh ${args}` : 'bash ./scripts/bootstrap/official.sh';
  run(command, 'Executando bootstrap oficial');
}

if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[system:bootstrap] FAIL: ${error.message || error}`);
    process.exit(1);
  }
}
