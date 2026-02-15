#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const RELEASE_GATE_REPORT_PATH = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
const ROLLBACK_DRILL_REPORT_PATH = process.env.ROLLBACK_DRILL_REPORT_PATH || 'qa/rollback-drill-report.json';
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || 'qa/go-no-go-report.json';
const RELEASE_DECISION_PATH = process.env.RELEASE_DECISION_PATH || 'qa/release-decision.json';
const LAUNCH_PLAN_STATUS_PATH = process.env.LAUNCH_PLAN_STATUS_PATH || 'qa/launch-plan-status.json';
const RELEASE_WINDOW_REPORT_PATH = process.env.RELEASE_WINDOW_REPORT_PATH || 'qa/release-window-report.json';
const RELEASE_MANIFEST_PATH = process.env.RELEASE_MANIFEST_PATH || 'qa/release-manifest.json';
const RELEASE_SUITE_CONFIRMATION_PATH = process.env.RELEASE_SUITE_CONFIRMATION_PATH || 'qa/release-suite-confirmation.json';
const OUTPUT_PATH = process.env.RELEASE_SUMMARY_PATH || 'qa/release-summary.md';

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

function statusLine(label, value) {
  const v = value == null || value === '' ? 'missing' : String(value);
  return `- ${label}: ${v}`;
}

function main() {
  const gate = readJson(RELEASE_GATE_REPORT_PATH);
  const drill = readJson(ROLLBACK_DRILL_REPORT_PATH);
  const goNoGo = readJson(GO_NO_GO_REPORT_PATH);
  const releaseDecision = readJson(RELEASE_DECISION_PATH);
  const plan = readJson(LAUNCH_PLAN_STATUS_PATH);
  const window = readJson(RELEASE_WINDOW_REPORT_PATH);
  const manifest = readJson(RELEASE_MANIFEST_PATH);
  const suiteConfirmation = readJson(RELEASE_SUITE_CONFIRMATION_PATH);

  const lines = [];
  lines.push('# Release Summary');
  lines.push('');
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push(`- Candidate: ${manifest?.candidate?.shortCommit || 'unknown'} (${manifest?.candidate?.branch || 'unknown'})`);
  lines.push(`- Decision: ${manifest?.decision || 'missing'}`);
  lines.push('');
  lines.push('## Gates');
  lines.push(statusLine('Release gate', gate?.status));
  lines.push(statusLine('Rollback drill', drill?.status));
  lines.push(statusLine('Go/No-Go', goNoGo?.decision));
  lines.push(statusLine('Release decision', releaseDecision?.status));
  lines.push(statusLine('Launch plan', plan?.overall));
  lines.push(statusLine('Release window', window?.status));
  lines.push(statusLine('Suites mínimas (Fast/Orders/PBX/ChatPro)', suiteConfirmation?.status));
  lines.push('');
  lines.push('## Reports');
  lines.push(statusLine('Release gate report', RELEASE_GATE_REPORT_PATH));
  lines.push(statusLine('Rollback drill report', ROLLBACK_DRILL_REPORT_PATH));
  lines.push(statusLine('Go/No-Go report', GO_NO_GO_REPORT_PATH));
  lines.push(statusLine('Release decision record', RELEASE_DECISION_PATH));
  lines.push(statusLine('Launch plan status', LAUNCH_PLAN_STATUS_PATH));
  lines.push(statusLine('Release window report', RELEASE_WINDOW_REPORT_PATH));
  lines.push(statusLine('Release manifest', RELEASE_MANIFEST_PATH));
  lines.push(statusLine('Release suite confirmation', RELEASE_SUITE_CONFIRMATION_PATH));
  lines.push('');

  const absOut = path.join(ROOT, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, `${lines.join('\n')}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[release-summary] written ${OUTPUT_PATH}`);
  process.exit(0);
}

main();
