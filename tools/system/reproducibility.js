#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runtimeAwarePath, resolveWorkspacePath, getRuntimeRoot } = require('./lib/runtime-paths');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = runtimeAwarePath(ROOT_DIR, 'qa/reproducibility-report.json', 'REPRODUCIBILITY_REPORT_PATH');

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';

function log(message, color = RESET) {
  // eslint-disable-next-line no-console
  console.log(`${color}${message}${RESET}`);
}

function runStep(step) {
  const startedAt = Date.now();
  log(`[system:reproducibility] ${step.label}`, BLUE);

  try {
    execSync(step.command, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    });
    return {
      id: step.id,
      label: step.label,
      command: step.command,
      status: 'pass',
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: step.id,
      label: step.label,
      command: step.command,
      status: 'fail',
      durationMs: Date.now() - startedAt,
      error: error.message || String(error),
    };
  }
}

function buildSteps() {
  const steps = [
    {
      id: 'bootstrap-check',
      label: 'Executando pré-checagens oficiais de bootstrap',
      command: 'npm run bootstrap:check',
    },
    {
      id: 'backend-build',
      label: 'Build do backend',
      command: 'npm run build:backend',
    },
    {
      id: 'frontend-build',
      label: 'Build do frontend',
      command: 'npm run frontend:build',
    },
    {
      id: 'frontend-smoke',
      label: 'Smoke do artefato frontend',
      command: 'npm run frontend:smoke',
    },
  ];

  if (String(process.env.SYSTEM_REPRO_RUN_BOOTSTRAP_FULL || '0') === '1') {
    steps.unshift({
      id: 'bootstrap-full',
      label: 'Executando bootstrap oficial completo (sem probes)',
      command: 'npm run system:bootstrap -- --skip-service-probes',
    });
  }

  if (String(process.env.SYSTEM_REPRO_INSTALL_DEPS || '0') === '1') {
    steps.unshift(
      {
        id: 'install-backend-deps',
        label: 'Instalando dependências do backend (npm ci)',
        command: 'npm ci --no-audit --no-fund',
      },
      {
        id: 'install-frontend-deps',
        label: 'Instalando dependências do frontend',
        command: 'npm run frontend:install',
      },
    );
  }

  return steps;
}

function writeReport(report) {
  const absPath = resolveWorkspacePath(ROOT_DIR, REPORT_PATH);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return absPath;
}

function main() {
  const startedAt = new Date().toISOString();
  const steps = buildSteps();
  const results = [];

  for (const step of steps) {
    const result = runStep(step);
    results.push(result);
    if (result.status !== 'pass') {
      break;
    }
  }

  const hasFailure = results.some((item) => item.status !== 'pass');
  const report = {
    source: 'system:reproducibility',
    startedAt,
    finishedAt: new Date().toISOString(),
    status: hasFailure ? 'NO_GO' : 'GO',
    runtimeRoot: getRuntimeRoot(ROOT_DIR),
    options: {
      installDeps: String(process.env.SYSTEM_REPRO_INSTALL_DEPS || '0') === '1',
      runBootstrapFull: String(process.env.SYSTEM_REPRO_RUN_BOOTSTRAP_FULL || '0') === '1',
    },
    steps: results,
  };

  const reportPath = writeReport(report);

  if (hasFailure) {
    log(`[system:reproducibility] NO_GO - veja relatório em ${reportPath}`, RED);
    process.exit(1);
  }

  log(`[system:reproducibility] GO - relatório em ${reportPath}`, GREEN);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[system:reproducibility] FAIL: ${error.message || error}`);
    process.exit(1);
  }
}
