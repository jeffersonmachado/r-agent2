#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const GO_NO_GO_REPORT_PATH = process.env.GO_NO_GO_REPORT_PATH || 'qa/go-no-go-report.json';
const OUTPUT_JSON_PATH = process.env.RELEASE_DECISION_PATH || 'qa/release-decision.json';
const OUTPUT_MD_PATH = process.env.RELEASE_DECISION_MD_PATH || 'qa/release-decision.md';
const CANDIDATE_TAG_ENV = process.env.RELEASE_CANDIDATE_TAG || '';
const CANDIDATE_BRANCH_ENV = process.env.RELEASE_CANDIDATE_BRANCH || '';
const DECISION_ENV = process.env.RELEASE_DECISION || '';
const RELEASE_SCOPE_FROZEN = String(process.env.RELEASE_SCOPE_FROZEN || '1') === '1';
const SCOPE_NOTES = process.env.RELEASE_SCOPE_NOTES || 'Apenas correcoes criticas e blockers.';
const ONCALL_ENGINEERING = process.env.RELEASE_ONCALL_ENGINEERING || 'Engenharia de Plataforma';
const ONCALL_OPERATIONS = process.env.RELEASE_ONCALL_OPERATIONS || 'Operacao';
const DECISION_OWNER = process.env.RELEASE_DECISION_OWNER || ONCALL_ENGINEERING;
const DECISION_APPROVERS = (process.env.RELEASE_DECISION_APPROVERS || `${ONCALL_ENGINEERING},${ONCALL_OPERATIONS}`)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_) {
    return null;
  }
}

function runGit(command) {
  try {
    return execSync(command, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
  } catch (_) {
    return '';
  }
}

function detectCandidateTag() {
  if (CANDIDATE_TAG_ENV) return CANDIDATE_TAG_ENV;
  const exact = runGit('git tag --points-at HEAD');
  if (exact) return exact.split('\n')[0].trim();
  const described = runGit('git describe --tags --always');
  return described || 'unknown';
}

function detectCandidateBranch() {
  if (CANDIDATE_BRANCH_ENV) return CANDIDATE_BRANCH_ENV;
  return runGit('git rev-parse --abbrev-ref HEAD') || 'unknown';
}

function toMarkdown(report) {
  const lines = [
    '# Release Decision Record',
    '',
    `- Recorded at: ${report.recordedAt}`,
    `- Status: ${report.status.toUpperCase()}`,
    `- Decision: ${report.decision}`,
    '',
    '## Candidate',
    `- Branch: ${report.candidate.branch}`,
    `- Tag: ${report.candidate.tag}`,
    `- Commit: ${report.candidate.commit}`,
    '',
    '## Scope Freeze',
    `- Frozen: ${report.scope.frozen ? 'yes' : 'no'}`,
    `- Notes: ${report.scope.notes}`,
    '',
    '## On-call / Owners',
    `- Engineering: ${report.owners.engineering}`,
    `- Operations: ${report.owners.operations}`,
    `- Decision owner: ${report.owners.decisionOwner}`,
    `- Approvers: ${report.owners.approvers.join(', ') || 'missing'}`,
    '',
    '## Evidence',
    `- Go/No-Go report: ${report.evidence.goNoGo.path} (${report.evidence.goNoGo.status})`,
    '',
  ];

  if (report.reasons.length > 0) {
    lines.push('## Reasons');
    report.reasons.forEach((reason) => lines.push(`- ${reason}`));
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function writeOutputs(report) {
  const jsonAbs = path.join(ROOT, OUTPUT_JSON_PATH);
  const mdAbs = path.join(ROOT, OUTPUT_MD_PATH);
  fs.mkdirSync(path.dirname(jsonAbs), { recursive: true });
  fs.mkdirSync(path.dirname(mdAbs), { recursive: true });
  fs.writeFileSync(jsonAbs, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdAbs, toMarkdown(report), 'utf8');
}

function main() {
  const goNoGo = readJson(GO_NO_GO_REPORT_PATH);
  const decision = DECISION_ENV || goNoGo?.decision || 'NO_GO';
  const report = {
    recordedAt: new Date().toISOString(),
    status: 'pass',
    decision,
    candidate: {
      branch: detectCandidateBranch(),
      tag: detectCandidateTag(),
      commit: runGit('git rev-parse HEAD') || 'unknown',
    },
    scope: {
      frozen: RELEASE_SCOPE_FROZEN,
      notes: SCOPE_NOTES,
    },
    owners: {
      engineering: ONCALL_ENGINEERING,
      operations: ONCALL_OPERATIONS,
      decisionOwner: DECISION_OWNER,
      approvers: DECISION_APPROVERS,
    },
    evidence: {
      goNoGo: {
        path: GO_NO_GO_REPORT_PATH,
        status: goNoGo?.status || 'missing',
        loaded: !!goNoGo,
      },
    },
    reasons: [],
  };

  if (!goNoGo) report.reasons.push('go_no_go_report_missing');
  if (decision !== 'GO') report.reasons.push('decision_is_not_go');
  if (!RELEASE_SCOPE_FROZEN) report.reasons.push('release_scope_not_frozen');
  if (!report.candidate.branch || report.candidate.branch === 'unknown') report.reasons.push('candidate_branch_missing');
  if (!report.candidate.tag || report.candidate.tag === 'unknown') report.reasons.push('candidate_tag_missing');
  if (!ONCALL_ENGINEERING) report.reasons.push('oncall_engineering_missing');
  if (!ONCALL_OPERATIONS) report.reasons.push('oncall_operations_missing');
  if (!DECISION_OWNER) report.reasons.push('decision_owner_missing');
  if (DECISION_APPROVERS.length === 0) report.reasons.push('decision_approvers_missing');

  if (report.reasons.length > 0) {
    report.status = 'fail';
  }

  writeOutputs(report);

  if (report.status === 'pass') {
    // eslint-disable-next-line no-console
    console.log(`[release-decision] PASS decision=${report.decision} path=${OUTPUT_JSON_PATH}`);
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`[release-decision] FAIL reasons=${report.reasons.join(',')} path=${OUTPUT_JSON_PATH}`);
  process.exit(1);
}

main();
