#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const BASE_DIR = process.env.RELEASE_EVIDENCE_BASE_DIR || 'qa/release-evidence';
const TARGET_DIR = process.env.RELEASE_EVIDENCE_DIR || '';

function sha256File(absPath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(absPath));
  return hash.digest('hex');
}

function pickLatestDir(baseAbs) {
  if (!fs.existsSync(baseAbs)) return null;
  const entries = fs.readdirSync(baseAbs, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (entries.length === 0) return null;
  return path.join(baseAbs, entries[entries.length - 1]);
}

function parseChecksums(content) {
  return String(content || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf('  ');
      if (sep <= 0) return null;
      return {
        expected: line.slice(0, sep).trim(),
        relPath: line.slice(sep + 2).trim(),
      };
    })
    .filter(Boolean);
}

function main() {
  const baseAbs = path.join(ROOT, BASE_DIR);
  const targetAbs = TARGET_DIR
    ? path.join(ROOT, TARGET_DIR)
    : pickLatestDir(baseAbs);

  if (!targetAbs || !fs.existsSync(targetAbs)) {
    // eslint-disable-next-line no-console
    console.error('[release-evidence-verify] FAIL: target directory not found');
    process.exit(1);
  }

  const sumsPath = path.join(targetAbs, 'SHA256SUMS');
  if (!fs.existsSync(sumsPath)) {
    // eslint-disable-next-line no-console
    console.error(`[release-evidence-verify] FAIL: missing SHA256SUMS in ${targetAbs}`);
    process.exit(1);
  }

  const entries = parseChecksums(fs.readFileSync(sumsPath, 'utf8'));
  if (entries.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`[release-evidence-verify] FAIL: empty SHA256SUMS in ${targetAbs}`);
    process.exit(1);
  }

  const failures = [];
  for (const entry of entries) {
    const absFile = path.join(targetAbs, entry.relPath);
    if (!fs.existsSync(absFile)) {
      failures.push(`missing:${entry.relPath}`);
      continue;
    }
    const actual = sha256File(absFile);
    if (actual !== entry.expected) {
      failures.push(`mismatch:${entry.relPath}`);
    }
  }

  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[release-evidence-verify] FAIL dir=${path.relative(ROOT, targetAbs)} issues=${failures.join(',')}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`[release-evidence-verify] PASS dir=${path.relative(ROOT, targetAbs)} files=${entries.length}`);
  process.exit(0);
}

main();
