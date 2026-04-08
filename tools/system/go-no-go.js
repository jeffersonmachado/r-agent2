#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { evaluatePillars } = require('./lib/pillar-readiness');

const ROOT = path.join(__dirname, '..', '..');
const SYSTEM_VALIDATE_REPORT_PATH = process.env.SYSTEM_VALIDATE_REPORT_PATH || 'qa/system-validate-report.json';
const RELEASE_GATE_REPORT_PATH = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
const ROLLBACK_DRILL_REPORT_PATH = process.env.ROLLBACK_DRILL_REPORT_PATH || 'qa/rollback-drill-report.json';
const SMOKE_EVIDENCE_SUMMARY_PATH = process.env.SMOKE_EVIDENCE_SUMMARY_PATH || 'qa/smoke-evidence.json';
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || 'qa/go-no-go-report.json';
const RUNTIME_GOVERNANCE_REPORT_PATH = process.env.RUNTIME_GOVERNANCE_REPORT_PATH || 'qa/runtime-governance-report.json';
const DEPLOY_REPORT_PATH = process.env.SYSTEM_DEPLOY_REPORT_PATH || 'qa/deploy-report.json';
const RUN_RELEASE_GATE = String(process.env.GO_NO_GO_RUN_RELEASE_GATE || '0') !== '0';
const RUN_ROLLBACK_DRILL = String(process.env.GO_NO_GO_RUN_ROLLBACK_DRILL || '0') !== '0';
const ROLLBACK_WITH_STACK = String(process.env.GO_NO_GO_ROLLBACK_WITH_STACK || '1') !== '0';

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
      validate: null,
      releaseGate: null,
      rollbackDrill: null,
      smoke: null,
      runtimeGovernance: null,
      deploy: null,
    },
    reasons: [],
  };

  try {
    if (RUN_RELEASE_GATE) {
      report.steps.push(runStep('node tools/system/release-gate.js', 'release-gate'));
    } else {
      report.steps.push({ label: 'release-gate', command: 'node tools/system/release-gate.js', status: 'skipped' });
    }

    if (RUN_ROLLBACK_DRILL) {
      report.steps.push(runRollbackDrillStep());
    } else {
      report.steps.push({ label: 'rollback-drill', command: 'node tools/system/rollback-drill.js', status: 'skipped' });
    }

    const validateReport = readJson(SYSTEM_VALIDATE_REPORT_PATH);
    const gate = readJson(RELEASE_GATE_REPORT_PATH);
    const drill = readJson(ROLLBACK_DRILL_REPORT_PATH);
    const smokeSummary = readJson(SMOKE_EVIDENCE_SUMMARY_PATH);
    const runtimeGovernance = readJson(RUNTIME_GOVERNANCE_REPORT_PATH);
    const deployReport = readJson(DEPLOY_REPORT_PATH);

    report.checks.validate = {
      path: SYSTEM_VALIDATE_REPORT_PATH,
      loaded: !!validateReport,
      status: validateReport?.status || 'missing',
      result: validateReport?.result || 'missing',
    };

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
    report.checks.runtimeGovernance = {
      path: RUNTIME_GOVERNANCE_REPORT_PATH,
      loaded: !!runtimeGovernance,
      status: runtimeGovernance?.gateStatus || 'missing',
      classification: runtimeGovernance?.classification || 'missing',
    };
    report.checks.deploy = {
      path: DEPLOY_REPORT_PATH,
      loaded: !!deployReport,
      status: deployReport?.status || 'missing',
      artifact: deployReport?.artifact?.name || 'missing',
      portResolution: Array.isArray(deployReport?.portResolution) ? deployReport.portResolution : [],
      optional: true,
    };

    if (!validateReport || !['pass', 'degraded'].includes(validateReport.status)) report.reasons.push('system_validate_not_releasable');
    if (!gate || gate.status !== 'pass') report.reasons.push('release_gate_not_pass');
    if (!drill || drill.status !== 'pass') report.reasons.push('rollback_drill_not_pass');

    if (!runtimeGovernance) {
      report.reasons.push('runtime_governance_missing');
    } else if (runtimeGovernance.gateStatus === 'no_go') {
      report.reasons.push(`runtime_mode_blocked:${runtimeGovernance.classification || 'unknown'}`);
    }

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

    if (!RUN_ROLLBACK_DRILL) {
      report.checks.rollbackDrill.optional = true;
      report.reasons = report.reasons.filter((reason) => reason !== 'rollback_drill_not_pass');
    }

    if (report.reasons.length === 0) {
      if ((runtimeGovernance && runtimeGovernance.gateStatus === 'go_degraded') || validateReport?.status === 'degraded') {
        report.status = 'degraded';
        report.decision = 'GO_DEGRADED';
      } else {
        report.status = 'pass';
        report.decision = 'GO';
      }
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

  if (report.decision === 'GO' || report.decision === 'GO_DEGRADED') {
    // eslint-disable-next-line no-console
    console.log(`[go-no-go] GO report=${GO_NO_GO_REPORT_PATH}`);
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`[go-no-go] NO_GO reasons=${report.reasons.join(',')} report=${GO_NO_GO_REPORT_PATH}`);
  process.exit(1);
}

main();
