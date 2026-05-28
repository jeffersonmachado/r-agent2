'use strict';

const fs = require('fs');
const path = require('path');
const { REPORTS_DIR, readJson, scoreFromStatus, writeReport } = require('./common');

function reportScore(file, passScore = 100, failScore = 0) {
  const report = readJson(`reports/${file}`, null);
  if (!report) return { score: 0, status: 'MISSING' };
  return { score: scoreFromStatus(report.status, passScore, failScore), status: report.status };
}

const architecture = reportScore('ai-memory-validation-report.json');
const runtime = reportScore('runtime-routes-validation-report.json');
const qa = reportScore('qa-governance-validation-report.json');
const replay = reportScore('replay-governance-validation-report.json');
const release = reportScore('release-governance-validation-report.json');
const agent = reportScore('agent-adherence-report.json');
const self = reportScore('self-proving-report.json');

const scores = {
  architectureConsistency: architecture.score,
  runtimeValidation: runtime.score,
  qaGovernance: qa.score,
  replayIntegrity: replay.score,
  releaseHardening: release.score,
  agentAdherence: agent.score,
  selfProving: self.score,
};
scores.overallGovernance = Math.round(Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length);

const statuses = {
  architectureConsistency: architecture.status,
  runtimeValidation: runtime.status,
  qaGovernance: qa.status,
  replayIntegrity: replay.status,
  releaseHardening: release.status,
  agentAdherence: agent.status,
  selfProving: self.status,
};

const scoreReport = {
  name: 'governance-score',
  status: scores.overallGovernance >= 95 && Object.values(statuses).every((status) => status === 'PASS') ? 'PASS' : 'FAIL',
  ...scores,
  statuses,
};

writeReport('governance-score.json', scoreReport);

const dashboardPath = path.join(REPORTS_DIR, 'governance-dashboard.html');
const rows = Object.entries(scores).map(([key, value]) => `<tr><td>${key}</td><td>${value}</td><td>${statuses[key] || ''}</td></tr>`).join('\n');
fs.writeFileSync(dashboardPath, `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>RAP Governance Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 32px; color: #17202a; }
    table { border-collapse: collapse; width: 100%; max-width: 960px; }
    th, td { border: 1px solid #ccd3da; padding: 10px 12px; text-align: left; }
    th { background: #edf2f7; }
    .fail { color: #9f1239; font-weight: 700; }
    .pass { color: #166534; font-weight: 700; }
  </style>
</head>
<body>
  <h1>RAP Governance Dashboard</h1>
  <p>Status: <span class="${scoreReport.status === 'PASS' ? 'pass' : 'fail'}">${scoreReport.status}</span></p>
  <p>Overall Governance: ${scores.overallGovernance}</p>
  <table>
    <thead><tr><th>Dimension</th><th>Score</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p>Reports are stored in <code>reports/*.json</code>.</p>
</body>
</html>
`);

console.log(JSON.stringify(scoreReport, null, 2));
if (scoreReport.status !== 'PASS') {
  process.exit(1);
}
