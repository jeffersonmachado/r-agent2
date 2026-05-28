'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  exists,
  failIfNeeded,
  listFiles,
  readJson,
  readText,
  statusFromIssues,
  writeReport,
} = require('./common');

const issues = [];
const warnings = [];

const evidenceMd = 'AI_MEMORY/evidence/browser-validation-2026-05-16.md';
const screenshotDir = 'AI_MEMORY/evidence/screenshots-2026-05-16';
const summaryPath = `${screenshotDir}/summary.json`;

if (!exists(evidenceMd)) {
  issues.push({ code: 'browser_evidence_missing', file: evidenceMd, message: 'Browser validation evidence markdown is missing.' });
} else {
  const text = readText(evidenceMd);
  for (const term of ['Login', 'Validated', 'Screenshot artifacts', 'Final validation run', 'Cleanup policy']) {
    if (!text.includes(term)) {
      issues.push({ code: 'browser_evidence_section_missing', term, message: `Browser evidence is missing section/term ${term}.` });
    }
  }
}

if (!exists(summaryPath)) {
  issues.push({ code: 'screenshot_summary_missing', file: summaryPath, message: 'Screenshot summary is missing.' });
}

const screenshots = listFiles(screenshotDir, (full) => full.endsWith('.png'));
if (screenshots.length < 7) {
  issues.push({ code: 'insufficient_screenshots', count: screenshots.length, message: 'Browser evidence must include screenshots for required routes.' });
}
for (const screenshot of screenshots) {
  const stat = fs.statSync(path.join(ROOT, screenshot));
  if (stat.size < 1024) {
    issues.push({ code: 'invalid_screenshot_size', file: screenshot, size: stat.size, message: `${screenshot} is too small to be valid evidence.` });
  }
}

const summary = readJson(summaryPath, null);
if (summary && Array.isArray(summary.routes)) {
  const names = summary.routes.map((route) => route.path || route.requested || route.name || '');
  for (const required of ['/support', '/dev/system-status', '/dev/rpa-replays', '/rag-documents', '/channel-health', '/generate-system']) {
    if (!names.some((name) => String(name).includes(required))) {
      warnings.push({ code: 'route_screenshot_not_declared', route: required, message: `${required} not found in screenshot summary routes.` });
    }
  }
}

const forbiddenEvidenceInDist = listFiles('dist', (full) => /screenshot|trace|playwright-report|\.har$|\.webm$|dump|backup|node_modules/i.test(full));
for (const file of forbiddenEvidenceInDist) {
  issues.push({ code: 'forbidden_evidence_in_dist', file, message: `${file} must not be in dist/.` });
}

const forbiddenRepoArtifacts = listFiles('.', (full) => {
  const relative = path.relative(ROOT, full).replace(/\\/g, '/');
  if (relative.startsWith('.git/') || relative.startsWith('node_modules/') || relative.startsWith('frontend/node_modules/')) return false;
  if (!(relative.startsWith('AI_MEMORY/evidence/') || relative.startsWith('qa/') || relative.startsWith('reports/'))) return false;
  return /(^|\/)(\.env|\.token\.env)$|\.dump$|\.bak$|\.backup$|\.trace\.zip$|\.har$|\.webm$/i.test(relative);
});
for (const file of forbiddenRepoArtifacts) {
  issues.push({ code: 'forbidden_runtime_artifact', file, message: `${file} violates browser evidence cleanup policy.` });
}

const report = {
  name: 'validate-browser-evidence',
  status: statusFromIssues(issues),
  screenshotsChecked: screenshots.length,
  forbiddenEvidenceInDist,
  issues,
  warnings,
  suggestions: issues.concat(warnings).map((entry) => entry.message),
};

writeReport('browser-evidence-validation-report.json', report);
failIfNeeded(report);
