#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const REPORT_PATH = process.env.RELEASE_WINDOW_REPORT_PATH || 'qa/release-window-report.json';
const FAST_MODE = String(process.env.RELEASE_WINDOW_FAST || '0') === '1';

function runStep(report, label, command, envPatch = {}) {
  const startedAt = Date.now();
  const step = {
    label,
    command,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: 0,
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
    mode: FAST_MODE ? 'fast' : 'full',
    status: 'running',
    steps: [],
    artifacts: {
      goNoGo: 'qa/go-no-go-report.json',
      launchPlanStatus: 'qa/launch-plan-status.json',
      launchPlanStatusMd: 'qa/launch-plan-status.md',
      evidencePackRoot: 'qa/release-evidence',
      releaseWindowReport: REPORT_PATH,
    },
    error: null,
  };

  try {
    if (!FAST_MODE) {
      runStep(report, 'release-clean-check', 'node tools/system/release-clean-check.js');
    } else {
      report.steps.push({
        label: 'release-clean-check',
        command: 'node tools/system/release-clean-check.js',
        status: 'skipped',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        error: null,
      });
    }
    runStep(
      report,
      'go-no-go',
      'node tools/system/go-no-go.js',
      FAST_MODE ? { GO_NO_GO_RUN_RELEASE_GATE: '0', GO_NO_GO_RUN_ROLLBACK_DRILL: '0' } : {}
    );
    runStep(report, 'launch-plan-status', 'node tools/system/launch-plan-status.js');
    runStep(
      report,
      'release-evidence-pack',
      'node tools/system/release-evidence-pack.js',
      FAST_MODE ? { RELEASE_EVIDENCE_DRY_RUN: '1' } : {}
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
    console.log(`[release-window] PASS mode=${report.mode} report=${REPORT_PATH}`);
    process.exit(0);
  }
  // eslint-disable-next-line no-console
  console.error(`[release-window] FAIL mode=${report.mode} report=${REPORT_PATH}`);
  process.exit(1);
}

main();
