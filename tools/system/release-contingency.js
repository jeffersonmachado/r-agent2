#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runtimeAwarePath, resolveWorkspacePath } = require('./lib/runtime-paths');

const ROOT = path.join(__dirname, '..', '..');
const REPORT_PATH = runtimeAwarePath(ROOT, 'qa/release-contingency-report.json', 'RELEASE_CONTINGENCY_REPORT_PATH');
const DRY_RUN = String(process.env.RELEASE_CONTINGENCY_DRY_RUN || '0') === '1';
const RUN_BACKUP = String(process.env.RELEASE_CONTINGENCY_RUN_BACKUP || '1') !== '0';
const RUN_GO_NO_GO = String(process.env.RELEASE_CONTINGENCY_RUN_GO_NO_GO || '1') !== '0';

function runStep(report, label, command, envPatch = {}) {
  const step = {
    label,
    command,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  report.steps.push(step);

  try {
    execSync(command, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...envPatch },
    });
    step.status = 'pass';
  } catch (err) {
    step.status = 'fail';
    step.error = err && err.message ? err.message : String(err);
    throw err;
  } finally {
    step.finishedAt = new Date().toISOString();
  }
}

function skipStep(report, label, command, reason) {
  report.steps.push({
    label,
    command,
    status: 'skipped',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: null,
    reason,
  });
}

function writeReport(report) {
  const abs = resolveWorkspacePath(ROOT, REPORT_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    dryRun: DRY_RUN,
    config: {
      runBackup: RUN_BACKUP,
      runGoNoGo: RUN_GO_NO_GO,
      releaseGateMode: process.env.RELEASE_GATE_MODE || 'default',
    },
    steps: [],
    artifacts: {
      releaseGate: runtimeAwarePath(ROOT, 'qa/release-gate-report.json', 'RELEASE_GATE_REPORT_PATH'),
      goNoGo: runtimeAwarePath(ROOT, 'qa/go-no-go-report.json', 'GO_NO_GO_REPORT_PATH'),
      launchPlanStatus: runtimeAwarePath(ROOT, 'qa/launch-plan-status.json', 'LAUNCH_PLAN_STATUS_PATH'),
      launchPlanStatusMd: runtimeAwarePath(ROOT, 'qa/launch-plan-status.md', 'LAUNCH_PLAN_STATUS_MD_PATH'),
      report: REPORT_PATH,
    },
    error: null,
  };

  try {
    if (DRY_RUN) {
      skipStep(report, 'postgres-backup', 'bash scripts/backup-postgres.sh', 'DRY_RUN');
      skipStep(report, 'release-gate', 'node tools/system/release-gate.js', 'DRY_RUN');
      skipStep(report, 'go-no-go', 'node tools/system/go-no-go.js', 'DRY_RUN');
      skipStep(report, 'launch-plan-status', 'node tools/system/launch-plan-status.js', 'DRY_RUN');
      report.status = 'pass';
    } else {
      if (RUN_BACKUP) {
        runStep(report, 'postgres-backup', 'bash scripts/backup-postgres.sh');
      } else {
        skipStep(report, 'postgres-backup', 'bash scripts/backup-postgres.sh', 'RELEASE_CONTINGENCY_RUN_BACKUP=0');
      }

      runStep(report, 'release-gate', 'node tools/system/release-gate.js');

      if (RUN_GO_NO_GO) {
        runStep(
          report,
          'go-no-go',
          'node tools/system/go-no-go.js',
          { GO_NO_GO_RUN_RELEASE_GATE: '0' }
        );
      } else {
        skipStep(report, 'go-no-go', 'node tools/system/go-no-go.js', 'RELEASE_CONTINGENCY_RUN_GO_NO_GO=0');
      }

      runStep(report, 'launch-plan-status', 'node tools/system/launch-plan-status.js');
      report.status = 'pass';
    }
  } catch (err) {
    report.status = 'fail';
    report.error = err && err.message ? err.message : String(err);
  }

  report.finishedAt = new Date().toISOString();
  writeReport(report);

  if (report.status === 'pass') {
    // eslint-disable-next-line no-console
    console.log(`[release-contingency] PASS report=${REPORT_PATH}`);
    process.exit(0);
  }
  // eslint-disable-next-line no-console
  console.error(`[release-contingency] FAIL report=${REPORT_PATH}`);
  process.exit(1);
}

main();
