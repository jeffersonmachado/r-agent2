#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeExecutionRecord } = require('../qa-mesh/meshRunner');

const ROOT_DIR = path.join(__dirname, '..');
const HISTORY_DIR = path.join(ROOT_DIR, 'qa-mesh', 'meshHistory');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function canSafelyAnnotate(original, normalized) {
  if (!normalized || normalized.executionOrigin === 'unknown') return false;

  const originalOrigin = original.executionOrigin || original.summary?.executionOrigin || null;
  const originalCanonical = original.isCanonicalExecution ?? original.summary?.isCanonicalExecution;

  if (originalOrigin === normalized.executionOrigin && originalCanonical === normalized.isCanonicalExecution) {
    return false;
  }

  return ['pipeline', 'manual_run', 'scheduler'].includes(normalized.executionOrigin);
}

function processFile(filePath, shouldWrite) {
  const original = readJson(filePath);
  const normalized = normalizeExecutionRecord(original);

  if (!canSafelyAnnotate(original, normalized)) {
    return { filePath, changed: false, origin: normalized.executionOrigin || 'unknown' };
  }

  if (shouldWrite) {
    writeJson(filePath, normalized);
  }

  return {
    filePath,
    changed: true,
    origin: normalized.executionOrigin,
    canonical: normalized.isCanonicalExecution === true,
  };
}

function main() {
  const shouldWrite = process.argv.includes('--write');
  const files = fs.readdirSync(HISTORY_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(HISTORY_DIR, file));

  let changedCount = 0;
  const byOrigin = new Map();

  for (const filePath of files) {
    const report = processFile(filePath, shouldWrite);
    if (!report.changed) continue;
    changedCount += 1;
    byOrigin.set(report.origin, (byOrigin.get(report.origin) || 0) + 1);
    console.log(`${shouldWrite ? 'updated' : 'would-update'} ${path.basename(filePath)} origin=${report.origin} canonical=${report.canonical ? 'yes' : 'no'}`);
  }

  console.log(`files_changed=${changedCount}`);
  for (const [origin, count] of Array.from(byOrigin.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`origin_${origin}=${count}`);
  }
  console.log(`mode=${shouldWrite ? 'write' : 'dry-run'}`);
}

main();
