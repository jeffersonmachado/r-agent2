#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runtimeAwarePath, resolveWorkspacePath } = require('./lib/runtime-paths');

const ROOT = path.join(__dirname, '..', '..');
const REPORT_PATH = runtimeAwarePath(ROOT, 'qa/release-window-report.json', 'RELEASE_WINDOW_REPORT_PATH');
const FAST_MODE = String(process.env.RELEASE_WINDOW_FAST || '0') === '1';
const PRUNE_OLD = String(process.env.RELEASE_WINDOW_PRUNE_OLD || '0') === '1';
const RUN_BACKUP = !FAST_MODE && String(process.env.RELEASE_WINDOW_RUN_BACKUP || '0') === '1';
const RELEASE_EVIDENCE_BASE_DIR = runtimeAwarePath(ROOT, 'qa/release-evidence', 'RELEASE_EVIDENCE_BASE_DIR');

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
  const abs = resolveWorkspacePath(REPORT_PATH);
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
      goNoGo: runtimeAwarePath(ROOT, 'qa/go-no-go-report.json', 'GO_NO_GO_REPORT_PATH'),
      launchPlanStatus: runtimeAwarePath(ROOT, 'qa/launch-plan-status.json', 'LAUNCH_PLAN_STATUS_PATH'),
      launchPlanStatusMd: runtimeAwarePath(ROOT, 'qa/launch-plan-status.md', 'LAUNCH_PLAN_STATUS_MD_PATH'),
      releaseManifest: runtimeAwarePath(ROOT, 'qa/release-manifest.json', 'RELEASE_MANIFEST_PATH'),
      releaseSummary: runtimeAwarePath(ROOT, 'qa/release-summary.md', 'RELEASE_SUMMARY_PATH'),
      evidencePackRoot: RELEASE_EVIDENCE_BASE_DIR,
      releaseWindowReport: REPORT_PATH,
    },
    config: {
      pruneOldEvidence: PRUNE_OLD,
      runBackup: RUN_BACKUP,
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
    runStep(report, 'release-decision', 'node tools/system/release-decision.js');
    runStep(
      report,
      'launch-plan-status',
      'node tools/system/launch-plan-status.js',
      { LAUNCH_PLAN_ALLOW_PENDING_RELEASE_WINDOW: '1' }
    );
    runStep(
      report,
      'release-manifest',
      'node tools/system/release-manifest.js',
      { RELEASE_MANIFEST_ALLOW_PENDING_RELEASE_WINDOW: '1' }
    );
    runStep(report, 'release-summary', 'node tools/system/release-summary.js');
    runStep(
      report,
      'release-evidence-pack',
      'node tools/system/release-evidence-pack.js',
      FAST_MODE ? { RELEASE_EVIDENCE_DRY_RUN: '1' } : {}
    );
    if (!FAST_MODE) {
      runStep(report, 'release-evidence-verify', 'node tools/system/release-evidence-verify.js');
    } else {
      report.steps.push({
        label: 'release-evidence-verify',
        command: 'node tools/system/release-evidence-verify.js',
        status: 'skipped',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        error: null,
      });
    }
    if (!FAST_MODE && PRUNE_OLD) {
      runStep(
        report,
        'release-evidence-prune',
        'node tools/system/release-evidence-prune.js',
        { RELEASE_EVIDENCE_PRUNE_DRY_RUN: '0' }
      );
    } else {
      report.steps.push({
        label: 'release-evidence-prune',
        command: 'node tools/system/release-evidence-prune.js',
        status: 'skipped',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        error: null,
        reason: !FAST_MODE ? 'RELEASE_WINDOW_PRUNE_OLD=0' : 'FAST_MODE',
      });
    }
    if (RUN_BACKUP) {
      runStep(report, 'postgres-backup', 'bash scripts/backup-postgres.sh');
    } else {
      report.steps.push({
        label: 'postgres-backup',
        command: 'bash scripts/backup-postgres.sh',
        status: 'skipped',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        error: null,
        reason: FAST_MODE ? 'FAST_MODE' : 'RELEASE_WINDOW_RUN_BACKUP=0',
      });
    }
    if (!FAST_MODE) {
      runStep(
        report,
        'checklist-strict',
        'node tools/system/checklist.js',
        { CHECKLIST_REQUIRE_LAUNCH_EVIDENCE: '1' }
      );
    } else {
      report.steps.push({
        label: 'checklist-strict',
        command: 'node tools/system/checklist.js',
        status: 'skipped',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        error: null,
        reason: 'FAST_MODE',
      });
    }

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
