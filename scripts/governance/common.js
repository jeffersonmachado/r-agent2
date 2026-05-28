'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORTS_DIR = path.join(ROOT, 'reports');

function ensureReportsDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath, fallback = null) {
  try {
    return JSON.parse(readText(relPath));
  } catch (_) {
    return fallback;
  }
}

function writeReport(name, report) {
  ensureReportsDir();
  const out = path.join(REPORTS_DIR, name);
  const payload = {
    generatedAt: new Date().toISOString(),
    ...report,
  };
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  return out;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function listFiles(dirRel, predicate = () => true) {
  const start = path.join(ROOT, dirRel);
  if (!fs.existsSync(start)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (predicate(full)) {
        out.push(rel(full));
      }
    }
  };
  walk(start);
  return out.sort();
}

function statusFromIssues(issues) {
  return issues.length === 0 ? 'PASS' : 'FAIL';
}

function failIfNeeded(report) {
  if (report.status && report.status !== 'PASS') {
    console.error(`[governance] ${report.name || 'validator'}: ${report.status}`);
    for (const issue of report.issues || []) {
      console.error(` - ${issue.code || 'issue'}: ${issue.message || issue}`);
    }
    process.exit(1);
  }
}

function scoreFromStatus(status, passScore = 100, failScore = 0) {
  return status === 'PASS' ? passScore : failScore;
}

module.exports = {
  ROOT,
  REPORTS_DIR,
  ensureReportsDir,
  exists,
  failIfNeeded,
  listFiles,
  readJson,
  readText,
  rel,
  scoreFromStatus,
  sha256,
  statusFromIssues,
  writeReport,
};
