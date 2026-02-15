#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const REPORT_PATH = process.env.RELEASE_D0_REPORT_PATH || 'qa/release-d0-report.json';
const DRY_RUN = String(process.env.RELEASE_D0_DRY_RUN || '1') === '1';
const DEPLOY_COMMAND = process.env.RELEASE_D0_DEPLOY_COMMAND || '';
const RUN_BACKUP = String(process.env.RELEASE_D0_RUN_BACKUP || '1') === '1';
const ALLOW_DIRTY = String(process.env.RELEASE_D0_ALLOW_DIRTY || (DRY_RUN ? '1' : '0')) === '1';

function runStep(report, label, command, options = {}) {
  const startedAt = Date.now();
  const step = {
    label,
    command,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: 0,
    error: null,
    reason: null,
  };
  report.steps.push(step);

  try {
    if (options.skip) {
      step.status = 'skipped';
      step.reason = options.skipReason || 'SKIPPED';
      return;
    }

    execSync(command, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...(options.envPatch || {}) },
    });
    step.status = 'pass';
  } catch (err) {
    step.status = 'fail';
    step.error = err && err.message ? err.message : String(err);
    throw err;
  } finally {
    step.finishedAt = new Date().toISOString();
    step.durationMs = Date.now() - startedAt;
  }
}

function writeReport(report) {
  const abs = path.join(ROOT, REPORT_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  const startedAt = Date.now();
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: 0,
    dryRun: DRY_RUN,
    status: 'running',
    steps: [],
    config: {
      deployCommandConfigured: !!DEPLOY_COMMAND,
      runBackup: RUN_BACKUP,
      allowDirtyWorkspace: ALLOW_DIRTY,
    },
    artifacts: {
      d0Report: REPORT_PATH,
      releaseWindowReport: 'qa/release-window-report.json',
      releaseGateReport: 'qa/release-gate-report.json',
      launchPlanStatus: 'qa/launch-plan-status.json',
      releaseManifest: 'qa/release-manifest.json',
      releaseSummary: 'qa/release-summary.md',
      releaseDecision: 'qa/release-decision.json',
      suiteConfirmation: 'qa/release-suite-confirmation.json',
    },
    error: null,
  };

  try {
    runStep(
      report,
      'release-clean-check',
      'node tools/system/release-clean-check.js',
      ALLOW_DIRTY ? { skip: true, skipReason: 'ALLOW_DIRTY_WORKSPACE' } : {}
    );

    runStep(
      report,
      'deploy-candidate',
      DEPLOY_COMMAND,
      DRY_RUN
        ? { skip: true, skipReason: 'DRY_RUN' }
        : !DEPLOY_COMMAND
          ? { skip: true, skipReason: 'RELEASE_D0_DEPLOY_COMMAND not set' }
          : {}
    );

    runStep(
      report,
      'release-window-full',
      'node tools/system/release-window.js',
      DRY_RUN
        ? {
            envPatch: {
              RELEASE_WINDOW_FAST: '1',
              GO_NO_GO_RUN_ROLLBACK_DRILL: '0',
            },
          }
        : {
            envPatch: {
              RELEASE_WINDOW_FAST: '0',
              RELEASE_WINDOW_RUN_BACKUP: RUN_BACKUP ? '1' : '0',
            },
          }
    );

    runStep(
      report,
      'release-gate-post-deploy',
      'node tools/system/release-gate.js',
      DRY_RUN ? { skip: true, skipReason: 'DRY_RUN' } : {}
    );

    runStep(report, 'release-suite-confirm', 'node tools/system/release-suite-confirm.js');
    runStep(report, 'release-manifest', 'node tools/system/release-manifest.js');
    runStep(report, 'release-summary', 'node tools/system/release-summary.js');

    runStep(
      report,
      'launch-plan-status-final',
      'node tools/system/launch-plan-status.js',
      { envPatch: DRY_RUN ? { LAUNCH_PLAN_ALLOW_PENDING_RELEASE_WINDOW: '1' } : {} }
    );

    runStep(
      report,
      'release-evidence-pack',
      'node tools/system/release-evidence-pack.js',
      DRY_RUN ? { envPatch: { RELEASE_EVIDENCE_DRY_RUN: '1' } } : {}
    );

    report.status = 'pass';
  } catch (err) {
    report.status = 'fail';
    report.error = err && err.message ? err.message : String(err);
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAt;
  writeReport(report);

  if (report.status === 'pass') {
    // eslint-disable-next-line no-console
    console.log(`[release-d0] PASS dryRun=${DRY_RUN ? '1' : '0'} report=${REPORT_PATH}`);
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`[release-d0] FAIL dryRun=${DRY_RUN ? '1' : '0'} report=${REPORT_PATH}`);
  process.exit(1);
}

main();
