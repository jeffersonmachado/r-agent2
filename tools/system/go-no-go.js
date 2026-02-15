#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { evaluatePillars } = require('./lib/pillar-readiness');

const ROOT = path.join(__dirname, '..', '..');
const RELEASE_GATE_REPORT_PATH = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
const ROLLBACK_DRILL_REPORT_PATH = process.env.ROLLBACK_DRILL_REPORT_PATH || 'qa/rollback-drill-report.json';
const SMOKE_EVIDENCE_SUMMARY_PATH = process.env.SMOKE_EVIDENCE_SUMMARY_PATH || 'qa/smoke-evidence.json';
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || 'qa/go-no-go-report.json';
const RUN_RELEASE_GATE = String(process.env.GO_NO_GO_RUN_RELEASE_GATE || '1') !== '0';
const RUN_ROLLBACK_DRILL = String(process.env.GO_NO_GO_RUN_ROLLBACK_DRILL || '1') !== '0';
const ROLLBACK_WITH_STACK = String(process.env.GO_NO_GO_ROLLBACK_WITH_STACK || '1') !== '0';
const ALLOW_EXISTING_GATE_ON_FAILURE = String(process.env.GO_NO_GO_ALLOW_EXISTING_GATE_ON_FAILURE || '0') === '1';
const ALLOW_EXISTING_ROLLBACK_ON_FAILURE = String(process.env.GO_NO_GO_ALLOW_EXISTING_ROLLBACK_ON_FAILURE || '0') === '1';
const EXISTING_REPORT_MAX_AGE_MIN = Number(process.env.GO_NO_GO_EXISTING_REPORT_MAX_AGE_MIN || '360');

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

function runStep(command, label) {
  execSync(command, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  return { label, command, status: 'pass' };
}

function readJsonWithMeta(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return { data: null, ageMinutes: null };
  let ageMinutes = null;
  try {
    const st = fs.statSync(abs);
    ageMinutes = Math.max(0, Math.round((Date.now() - st.mtimeMs) / 60000));
  } catch (_) {
    ageMinutes = null;
  }
  return { data: readJson(relPath), ageMinutes };
}

function canReuseExistingReport(reportData, ageMinutes) {
  if (!reportData || reportData.status !== 'pass') return false;
  if (typeof ageMinutes !== 'number') return false;
  return ageMinutes <= EXISTING_REPORT_MAX_AGE_MIN;
}

function runRollbackDrillStep() {
  if (!ROLLBACK_WITH_STACK) {
    return runStep('node tools/system/rollback-drill.js', 'rollback-drill');
  }

  const command = [
    'bash -lc',
    '\'set -euo pipefail;',
    'cleanup(){ bash scripts/test-stack-down.sh || true; };',
    'trap cleanup EXIT;',
    'bash scripts/test-stack-up.sh;',
    'bash scripts/wait-ready.sh;',
    'ROLLBACK_DRILL_API_URL="${ROLLBACK_DRILL_API_URL:-http://localhost:13001}"',
    'TEST_TENANT_ID="${TEST_TENANT_ID:-system}"',
    'node tools/system/rollback-drill.js\'',
  ].join(' ');

  return runStep(command, 'rollback-drill');
}

function writeReport(report) {
  const abs = path.join(ROOT, GO_NO_GO_REPORT_PATH);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function main() {
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    decision: 'NO_GO',
    steps: [],
    checks: {
      releaseGate: null,
      rollbackDrill: null,
      smoke: null,
    },
    reasons: [],
  };

  try {
    if (RUN_RELEASE_GATE) {
      try {
        report.steps.push(runStep('node tools/system/release-gate.js', 'release-gate'));
      } catch (err) {
        const gateMeta = readJsonWithMeta(RELEASE_GATE_REPORT_PATH);
        const fallbackOk = ALLOW_EXISTING_GATE_ON_FAILURE && canReuseExistingReport(gateMeta.data, gateMeta.ageMinutes);
        if (!fallbackOk) throw err;
        report.steps.push({
          label: 'release-gate',
          command: 'node tools/system/release-gate.js',
          status: 'warn',
          reason: `fallback_existing_report ageMinutes=${gateMeta.ageMinutes}`,
        });
      }
    } else {
      report.steps.push({ label: 'release-gate', command: 'node tools/system/release-gate.js', status: 'skipped' });
    }

    if (RUN_ROLLBACK_DRILL) {
      try {
        report.steps.push(runRollbackDrillStep());
      } catch (err) {
        const drillMeta = readJsonWithMeta(ROLLBACK_DRILL_REPORT_PATH);
        const fallbackOk = ALLOW_EXISTING_ROLLBACK_ON_FAILURE && canReuseExistingReport(drillMeta.data, drillMeta.ageMinutes);
        if (!fallbackOk) throw err;
        report.steps.push({
          label: 'rollback-drill',
          command: 'node tools/system/rollback-drill.js',
          status: 'warn',
          reason: `fallback_existing_report ageMinutes=${drillMeta.ageMinutes}`,
        });
      }
    } else {
      report.steps.push({ label: 'rollback-drill', command: 'node tools/system/rollback-drill.js', status: 'skipped' });
    }

    const gate = readJson(RELEASE_GATE_REPORT_PATH);
    const drill = readJson(ROLLBACK_DRILL_REPORT_PATH);
    const smokeSummary = readJson(SMOKE_EVIDENCE_SUMMARY_PATH);

    report.checks.releaseGate = {
      path: RELEASE_GATE_REPORT_PATH,
      loaded: !!gate,
      status: gate?.status || 'missing',
    };
    report.checks.rollbackDrill = {
      path: ROLLBACK_DRILL_REPORT_PATH,
      loaded: !!drill,
      status: drill?.status || 'missing',
    };

    if (!gate || gate.status !== 'pass') report.reasons.push('release_gate_not_pass');
    if (!drill || drill.status !== 'pass') report.reasons.push('rollback_drill_not_pass');

    if (!smokeSummary || !smokeSummary.smokes) {
      report.checks.smoke = {
        path: SMOKE_EVIDENCE_SUMMARY_PATH,
        loaded: false,
        status: 'missing',
      };
      report.reasons.push('smoke_evidence_missing');
    } else {
      const smokeCheck = evaluatePillars(smokeSummary.smokes);
      report.checks.smoke = {
        path: SMOKE_EVIDENCE_SUMMARY_PATH,
        loaded: true,
        status: smokeCheck.ok ? 'pass' : 'fail',
        pbx: smokeCheck.pillars.pbx.l03,
        pillars: smokeCheck.pillars,
        reasons: smokeCheck.reasons,
      };
      if (!smokeCheck.ok) {
        report.reasons.push(...smokeCheck.reasons);
      }
    }

    if (report.reasons.length === 0) {
      report.status = 'pass';
      report.decision = 'GO';
    } else {
      report.status = 'fail';
      report.decision = 'NO_GO';
    }
  } catch (err) {
    report.status = 'fail';
    report.decision = 'NO_GO';
    report.reasons.push(err && err.message ? err.message : String(err));
  }

  report.finishedAt = new Date().toISOString();
  writeReport(report);

  if (report.decision === 'GO') {
    // eslint-disable-next-line no-console
    console.log(`[go-no-go] GO report=${GO_NO_GO_REPORT_PATH}`);
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`[go-no-go] NO_GO reasons=${report.reasons.join(',')} report=${GO_NO_GO_REPORT_PATH}`);
  process.exit(1);
}

main();
