#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUTPUT_PATH = process.env.RELEASE_MANIFEST_PATH || 'qa/release-manifest.json';
const RELEASE_GATE_REPORT_PATH = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
const ROLLBACK_DRILL_REPORT_PATH = process.env.ROLLBACK_DRILL_REPORT_PATH || 'qa/rollback-drill-report.json';
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || 'qa/go-no-go-report.json';
const LAUNCH_PLAN_STATUS_PATH = process.env.LAUNCH_PLAN_STATUS_PATH || 'qa/launch-plan-status.json';
const RELEASE_WINDOW_REPORT_PATH = process.env.RELEASE_WINDOW_REPORT_PATH || 'qa/release-window-report.json';
const ALLOW_PENDING_RELEASE_WINDOW = String(process.env.RELEASE_MANIFEST_ALLOW_PENDING_RELEASE_WINDOW || '0') === '1';

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

function runGit(args, fallback = '') {
  try {
    const out = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out || '').trim();
  } catch (err) {
    if (err && Number(err.status) === 0 && typeof err.stdout === 'string') {
      return String(err.stdout || '').trim();
    }
    return fallback;
  }
}

function buildManifest() {
  const releaseGate = readJson(RELEASE_GATE_REPORT_PATH);
  const rollbackDrill = readJson(ROLLBACK_DRILL_REPORT_PATH);
  const goNoGo = readJson(GO_NO_GO_REPORT_PATH);
  const launchPlan = readJson(LAUNCH_PLAN_STATUS_PATH);
  const releaseWindow = readJson(RELEASE_WINDOW_REPORT_PATH);

  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');
  const commit = runGit(['rev-parse', 'HEAD'], 'unknown');
  const shortCommit = runGit(['rev-parse', '--short', 'HEAD'], 'unknown');
  const tag = runGit(['describe', '--tags', '--exact-match'], '');
  const dirty = runGit(['status', '--porcelain'], '') !== '';

  const gatePass = releaseGate && releaseGate.status === 'pass';
  const drillPass = rollbackDrill && rollbackDrill.status === 'pass';
  const go = goNoGo && goNoGo.decision === 'GO';
  const planReady = launchPlan && launchPlan.overall === 'ready';
  const windowPass = ALLOW_PENDING_RELEASE_WINDOW
    ? !!releaseWindow
    : releaseWindow && releaseWindow.status === 'pass';

  return {
    generatedAt: new Date().toISOString(),
    candidate: {
      branch,
      commit,
      shortCommit,
      tag: tag || null,
      dirty,
    },
    checks: {
      releaseGate: {
        path: RELEASE_GATE_REPORT_PATH,
        status: releaseGate ? releaseGate.status : 'missing',
      },
      rollbackDrill: {
        path: ROLLBACK_DRILL_REPORT_PATH,
        status: rollbackDrill ? rollbackDrill.status : 'missing',
      },
      goNoGo: {
        path: GO_NO_GO_REPORT_PATH,
        decision: goNoGo ? goNoGo.decision : 'missing',
      },
      launchPlan: {
        path: LAUNCH_PLAN_STATUS_PATH,
        overall: launchPlan ? launchPlan.overall : 'missing',
      },
      releaseWindow: {
        path: RELEASE_WINDOW_REPORT_PATH,
        status: releaseWindow ? releaseWindow.status : 'missing',
      },
    },
    decision: gatePass && drillPass && go && planReady && windowPass ? 'READY' : 'BLOCKED',
  };
}

function main() {
  const manifest = buildManifest();
  const abs = path.join(ROOT, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[release-manifest] decision=${manifest.decision} commit=${manifest.candidate.shortCommit} path=${OUTPUT_PATH}`);
  process.exit(manifest.decision === 'READY' ? 0 : 1);
}

main();
