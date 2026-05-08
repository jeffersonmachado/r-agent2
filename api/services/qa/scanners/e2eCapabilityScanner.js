'use strict';

const fs = require('fs');
const path = require('path');

const E2E_DIR_CANDIDATES = [
  'frontend-e2e',
  'tests/e2e',
  'tests/flow',
];

const CAPABILITY_HINTS = [
  { id: 'support_ticket_flow', tags: ['support', 'ticket'] },
  { id: 'support_ticket_reply', tags: ['reply', 'ticket-send-button'] },
  { id: 'turnstile_release', tags: ['turnstile', 'catraca'] },
  { id: 'customer_identification', tags: ['face', 'rfid', 'identification'] },
  { id: 'attendance_record', tags: ['attendance', 'checkin'] },
  { id: 'omnichannel_pbx', tags: ['pbx', 'voip'] },
  { id: 'omnichannel_whatsapp', tags: ['whatsapp'] },
];

function listE2eFiles(rootDir) {
  const files = [];
  for (const relativeDir of E2E_DIR_CANDIDATES) {
    const fullDir = path.join(rootDir, relativeDir);
    if (!fs.existsSync(fullDir)) continue;
    walk(fullDir, files);
  }
  return files;
}

function walk(dirPath, results) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') {
        continue;
      }
      walk(fullPath, results);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(js|ts|jsx|tsx)$/i.test(entry.name)) continue;
    results.push(fullPath);
  }
}

function readSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function score(text, tags) {
  const normalized = String(text || '').toLowerCase();
  let points = 0;
  for (const tag of tags) {
    if (normalized.includes(String(tag).toLowerCase())) points += 1;
  }
  return points;
}

function scan(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..', '..', '..', '..');
  const files = listE2eFiles(rootDir);

  const matches = new Map();
  const uxSignals = {
    loadingChecks: 0,
    timeoutChecks: 0,
    visualErrorChecks: 0,
  };

  for (const filePath of files) {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = readSafe(filePath);
    const lc = content.toLowerCase();

    if (/loading|spinner|skeleton/.test(lc)) uxSignals.loadingChecks += 1;
    if (/timeout|waitfor|networkidle/.test(lc)) uxSignals.timeoutChecks += 1;
    if (/error|broken|empty state|empty-state/.test(lc)) uxSignals.visualErrorChecks += 1;

    for (const hint of CAPABILITY_HINTS) {
      const pts = score(`${rel} ${lc}`, hint.tags);
      if (pts < 2) continue;
      const rec = matches.get(hint.id) || { score: 0, evidence: [] };
      rec.score += pts;
      rec.evidence.push(rel);
      matches.set(hint.id, rec);
    }
  }

  return {
    kind: 'e2e',
    files: files.map((item) => path.relative(rootDir, item).replace(/\\/g, '/')),
    inferredCapabilities: Array.from(matches.entries()).map(([id, value]) => ({
      id,
      source: 'e2e',
      confidence: Math.min(1, value.score / 8),
      evidence: Array.from(new Set(value.evidence)).slice(0, 10),
    })),
    uxSignals,
  };
}

module.exports = {
  scan,
};
