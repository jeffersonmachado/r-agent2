#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { findLatestReleaseArtifact } = require('./lib/release-artifact');

const ROOT = path.join(__dirname, '..', '..');
const SYSTEM_VALIDATE_REPORT_PATH = process.env.SYSTEM_VALIDATE_REPORT_PATH || 'qa/system-validate-report.json';
const RELEASE_GATE_REPORT_PATH = process.env.RELEASE_GATE_REPORT_PATH || 'qa/release-gate-report.json';
const ROLLBACK_DRILL_REPORT_PATH = process.env.ROLLBACK_DRILL_REPORT_PATH || 'qa/rollback-drill-report.json';
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || 'qa/go-no-go-report.json';
const RUNTIME_GOVERNANCE_REPORT_PATH = process.env.RUNTIME_GOVERNANCE_REPORT_PATH || 'qa/runtime-governance-report.json';
const RELEASE_MANIFEST_PATH = process.env.RELEASE_MANIFEST_PATH || 'qa/release-manifest.json';
const DEPLOY_REPORT_PATH = process.env.SYSTEM_DEPLOY_REPORT_PATH || 'qa/deploy-report.json';
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
  const validate = readJson(SYSTEM_VALIDATE_REPORT_PATH);
  const gate = readJson(RELEASE_GATE_REPORT_PATH);
  const drill = readJson(ROLLBACK_DRILL_REPORT_PATH);
  const goNoGo = readJson(GO_NO_GO_REPORT_PATH);
  const runtime = readJson(RUNTIME_GOVERNANCE_REPORT_PATH);
  const deploy = readJson(DEPLOY_REPORT_PATH);
  const manifest = readJson(RELEASE_MANIFEST_PATH);
  const artifact = findLatestReleaseArtifact({ requireAuditPassed: true });

  const lines = [];
  lines.push('# Release Summary');
  lines.push('');
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push(`- Candidate: ${manifest?.candidate?.shortCommit || 'unknown'} (${manifest?.candidate?.branch || 'unknown'})`);
  lines.push(`- Decision: ${manifest?.decision || 'missing'}`);
  lines.push(`- Artifact: ${artifact.zip}`);
  lines.push(`- Artifact SHA-256: ${artifact.manifest.sha256 || 'missing'}`);
  lines.push('');
  lines.push('## Gates');
  lines.push(statusLine('System validate', validate?.status));
  lines.push(statusLine('Release gate', gate?.status));
  lines.push(statusLine('Rollback drill', drill?.status));
  lines.push(statusLine('Go/No-Go', goNoGo?.decision));
  lines.push(statusLine('Runtime governance', runtime?.classification));
  lines.push(statusLine('Last deploy', deploy?.status));
  lines.push('');
  lines.push('## Reports');
  lines.push(statusLine('System validate report', SYSTEM_VALIDATE_REPORT_PATH));
  lines.push(statusLine('Release gate report', RELEASE_GATE_REPORT_PATH));
  lines.push(statusLine('Rollback drill report', ROLLBACK_DRILL_REPORT_PATH));
  lines.push(statusLine('Go/No-Go report', GO_NO_GO_REPORT_PATH));
  lines.push(statusLine('Runtime governance report', RUNTIME_GOVERNANCE_REPORT_PATH));
  lines.push(statusLine('Deploy report', DEPLOY_REPORT_PATH));
  lines.push(statusLine('Release manifest', RELEASE_MANIFEST_PATH));
  lines.push('');

  if (deploy) {
    lines.push('## Last Deploy');
    lines.push(statusLine('Deploy status', deploy.status));
    lines.push(statusLine('Deploy artifact', deploy?.artifact?.name));
    if (Array.isArray(deploy.portResolution)) {
      for (const item of deploy.portResolution) {
        lines.push(statusLine(`Port ${item.service}`, `${item.envVar}=${item.selectedPort} (${item.strategy})`));
      }
    }
    lines.push('');
  }

  const absOut = path.join(ROOT, OUTPUT_PATH);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, `${lines.join('\n')}\n`, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[release-summary] written ${OUTPUT_PATH}`);
  process.exit(0);
}

main();
