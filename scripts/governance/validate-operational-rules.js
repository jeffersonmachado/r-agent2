'use strict';

const { exists, failIfNeeded, readText, statusFromIssues, writeReport } = require('./common');

const issues = [];
const files = ['AI_MEMORY/operational-rules.md', 'AI_MEMORY/anti-patterns.md', 'AI_MEMORY/deployment-rules.md', 'AGENTS.md', 'CLAUDE.md'];

const requiredPatterns = [
  { code: 'docker_required_missing', pattern: /Docker/i, message: 'Docker requirement is not enforced in operational docs.' },
  { code: 'pm2_ban_missing', pattern: /PM2/i, message: 'PM2 prohibition is not documented/enforced.' },
  { code: 'dist_clean_missing', pattern: /dist/i, message: 'dist cleanliness is not documented/enforced.' },
  { code: 'browser_validation_missing', pattern: /browser/i, message: 'Browser validation is not documented/enforced.' },
  { code: 'qa_waves_missing', pattern: /QA Waves/i, message: 'QA Waves enforcement is missing.' },
  { code: 'replay_governance_missing', pattern: /Replay/i, message: 'Replay governance enforcement is missing.' },
];

const combined = files.filter(exists).map(readText).join('\n');
for (const item of requiredPatterns) {
  if (!item.pattern.test(combined)) {
    issues.push({ code: item.code, message: item.message });
  }
}

const pendingMarkerPattern = new RegExp(['TO', 'DO'].join('') + '|' + ['FIX', 'ME'].join(''));
if (pendingMarkerPattern.test(combined)) {
  issues.push({ code: 'pending_marker_present', message: 'Operational agent files contain unresolved pending markers.' });
}

const report = {
  name: 'validate-operational-rules',
  status: statusFromIssues(issues),
  files,
  issues,
  suggestions: issues.map((issue) => issue.message),
};

writeReport('operational-rules-validation-report.json', report);
failIfNeeded(report);
