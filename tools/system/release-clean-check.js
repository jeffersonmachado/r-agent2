#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ALLOWED_PREFIXES = [
  'qa/',
  'rag-service/test-results/junit.xml',
];

function parsePorcelainLine(line) {
  const raw = String(line || '');
  if (!raw.trim()) return null;
  const status = raw.slice(0, 2);
  const rest = raw.slice(3);
  // Handle rename lines: "R  old -> new"
  const arrowIdx = rest.indexOf(' -> ');
  const path = arrowIdx >= 0 ? rest.slice(arrowIdx + 4) : rest;
  return { status, path };
}

function isAllowed(path) {
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

function readGitStatusPorcelain() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  } catch (err) {
    // Em alguns sandboxes, spawn pode lançar EPERM mesmo com status 0 e stdout válido.
    if (err && Number(err.status) === 0 && typeof err.stdout === 'string') {
      return err.stdout;
    }
    throw err;
  }
}

function main() {
  const gitDir = path.resolve(process.cwd(), '.git');
  if (!fs.existsSync(gitDir)) {
    // eslint-disable-next-line no-console
    console.log('[release-clean-check] SKIP: workspace sem .git (check aplicavel apenas em repositorio Git).');
    process.exit(0);
  }

  const output = readGitStatusPorcelain();
  const lines = output.split('\n').map(parsePorcelainLine).filter(Boolean);

  const blocked = lines.filter((item) => !isAllowed(item.path));
  if (blocked.length > 0) {
    // eslint-disable-next-line no-console
    console.error('[release-clean-check] FAIL: non-qa pending changes detected');
    for (const item of blocked) {
      // eslint-disable-next-line no-console
      console.error(` - ${item.status} ${item.path}`);
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`[release-clean-check] PASS allowedChanges=${lines.length}`);
  process.exit(0);
}

main();
