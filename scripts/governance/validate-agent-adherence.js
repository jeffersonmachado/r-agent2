'use strict';

const { exists, failIfNeeded, readText, statusFromIssues, writeReport } = require('./common');

const issues = [];
const warnings = [];
const evidence = 'AI_MEMORY/evidence/browser-validation-2026-05-16.md';
const agentFiles = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'];

for (const file of agentFiles) {
  if (!exists(file)) {
    issues.push({ code: 'agent_instruction_missing', file, message: `${file} is missing.` });
    continue;
  }
  const text = readText(file);
  for (const required of ['AI_MEMORY', 'browser', 'QA', 'Replay', 'release']) {
    if (!new RegExp(required, 'i').test(text)) {
      issues.push({ code: 'agent_instruction_term_missing', file, required, message: `${file} does not enforce ${required}.` });
    }
  }
}

if (!exists(evidence)) {
  issues.push({ code: 'agent_runtime_evidence_missing', file: evidence, message: 'Agent adherence requires runtime/browser validation evidence.' });
} else {
  const text = readText(evidence);
  const requiredEvidence = [
    'Login',
    'Routes',
    'npm run zip:release',
    'npm run test:governance',
    'qa:mesh',
    'system:release-gate',
  ];
  for (const term of requiredEvidence) {
    if (!text.includes(term)) {
      issues.push({ code: 'agent_evidence_term_missing', term, message: `Evidence does not mention ${term}.` });
    }
  }
  if (/NO_GO/.test(text)) {
    warnings.push({ code: 'agent_recorded_no_go', message: 'Evidence correctly records NO_GO; release acceptance remains blocked.' });
  }
}

const report = {
  name: 'validate-agent-adherence',
  status: statusFromIssues(issues),
  agentFiles,
  evidence,
  issues,
  warnings,
  suggestions: issues.concat(warnings).map((entry) => entry.message),
};

writeReport('agent-adherence-report.json', report);
failIfNeeded(report);
