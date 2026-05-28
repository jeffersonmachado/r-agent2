'use strict';

const { execFileSync } = require('child_process');
const { failIfNeeded, listFiles, statusFromIssues, writeReport } = require('./common');

const issues = [];
let checkOutput = '';

try {
  checkOutput = execFileSync('bash', ['scripts/check-dist-clean.sh'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  checkOutput = `${error.stdout || ''}${error.stderr || ''}`;
  issues.push({ code: 'check_dist_clean_failed', message: 'scripts/check-dist-clean.sh failed.' });
}

const forbidden = listFiles('dist', (full) => /node_modules|\.env|\.token\.env|backup|dump|playwright-report|screenshots|\.trace\.zip|\.har|\.webm/i.test(full));
for (const file of forbidden) {
  issues.push({ code: 'dist_forbidden_artifact', file, message: `${file} is forbidden in dist/.` });
}

const report = {
  name: 'validate-dist-cleanliness',
  status: statusFromIssues(issues),
  forbidden,
  checkOutput: checkOutput.slice(-6000),
  issues,
  suggestions: issues.map((issue) => issue.message),
};

writeReport('dist-cleanliness-validation-report.json', report);
failIfNeeded(report);
