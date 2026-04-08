'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const HISTORY_DIR = path.join(ROOT, 'qa', 'mesh', 'intelligence', 'history');
const INDEX_PATH = path.join(HISTORY_DIR, 'index.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function persistStabilitySnapshot(snapshot) {
  ensureDir(HISTORY_DIR);
  const dateToken = new Date(snapshot.generatedAt || Date.now()).toISOString().slice(0, 10);
  const fileName = `stability-${dateToken}.json`;
  const filePath = path.join(HISTORY_DIR, fileName);

  let payload = [];
  if (fs.existsSync(filePath)) {
    const previous = safeReadJson(filePath, []);
    payload = Array.isArray(previous) ? previous : [previous];
  }
  payload.push(snapshot);

  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const index = safeReadJson(INDEX_PATH, { snapshots: [] });
  index.snapshots = Array.isArray(index.snapshots) ? index.snapshots : [];
  index.snapshots.unshift({
    generatedAt: snapshot.generatedAt,
    file: fileName,
    stabilityScore: snapshot.global?.stabilityScore ?? null,
    releaseReadiness: snapshot.global?.releaseReadiness ?? null,
    failures: Array.isArray(snapshot.failures) ? snapshot.failures.length : 0,
  });
  index.snapshots = index.snapshots.slice(0, 300);

  fs.writeFileSync(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

  return {
    historyFile: filePath,
    indexFile: INDEX_PATH,
  };
}

module.exports = {
  persistStabilitySnapshot,
  HISTORY_DIR,
  INDEX_PATH,
};
