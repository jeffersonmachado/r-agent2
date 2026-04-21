#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ALLOWED_PREFIXES = [
  'qa/',
  'rag-service/test-results/junit.xml',
];

const RUNTIME_RESIDUE_PATHS = [
  '.wwebjs_auth',
  '.wwebjs_cache',
  'api/data/wa_sessions',
  'data/executions',
  'frontend/.vite',
  'frontend/test-results',
  'qa/release-evidence',
  'qa/smoke',
  'qa-mesh/meshEvidence',
  'qa-mesh/meshHistory',
  'qa-mesh/system-validate',
  'rag-service/data/vector_store',
  'rag-service/test-results',
  'recordings',
  'replays',
  'dist/test-release',
];

const RUNTIME_RESIDUE_GLOBS = [
  /^qa-mesh\/isolated-run[^/]*$/,
  /^rag-service\/\.coverage$/,
  /^rag-service\/data\/adaptive_learning\/.*_learning\.json$/,
];

const TRACKED_RUNTIME_PATTERNS = [
  /^qa-mesh\/isolated-run[^/]*\//,
  /^qa-mesh\/system-validate\/meshEvidence\//,
  /^qa-mesh\/system-validate\/meshHistory\//,
  /^qa\/release-evidence\//,
  /^qa\/smoke\//,
  /^api\/data\/wa_sessions\//,
  /^rag-service\/data\/vector_store\//,
  /^rag-service\/data\/adaptive_learning\//,
  /^frontend\/\.vite\//,
  /^data\/executions\//,
  /^recordings\//,
  /^replays\//,
  /^\.wwebjs_auth\//,
  /^\.wwebjs_cache\//,
  /^dist\/test-release\//,
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

function readTrackedFiles(rootDir) {
  try {
    return execFileSync('git', ['ls-files'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    if (err && Number(err.status) === 0 && typeof err.stdout === 'string') {
      return err.stdout;
    }
    throw err;
  }
}

function hasContent(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      return fs.readdirSync(absPath).length > 0;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function isTrackedPath(rootDir, relPath) {
  try {
    const output = execFileSync('git', ['ls-files', '--', relPath], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim().length > 0;
  } catch (_) {
    return false;
  }
}

function collectRuntimeResidues(rootDir) {
  const blocked = [];

  for (const relPath of RUNTIME_RESIDUE_PATHS) {
    if (isTrackedPath(rootDir, relPath)) {
      continue;
    }
    const absPath = path.join(rootDir, relPath);
    if (fs.existsSync(absPath) && hasContent(absPath)) {
      blocked.push(relPath);
    }
  }

  const adaptiveDir = path.join(rootDir, 'rag-service/data/adaptive_learning');
  if (fs.existsSync(adaptiveDir)) {
    const entries = fs.readdirSync(adaptiveDir);
    for (const entry of entries) {
      const relPath = `rag-service/data/adaptive_learning/${entry}`;
      if (RUNTIME_RESIDUE_GLOBS[2].test(relPath)) {
        if (isTrackedPath(rootDir, relPath)) {
          continue;
        }
        blocked.push(relPath);
      }
    }
  }

  const qaMeshDir = path.join(rootDir, 'qa-mesh');
  if (fs.existsSync(qaMeshDir)) {
    const entries = fs.readdirSync(qaMeshDir);
    for (const entry of entries) {
      const relPath = `qa-mesh/${entry}`;
      if (isTrackedPath(rootDir, relPath)) {
        continue;
      }
      if (RUNTIME_RESIDUE_GLOBS[0].test(relPath) && hasContent(path.join(qaMeshDir, entry))) {
        blocked.push(relPath);
      }
    }
  }

  if (
    fs.existsSync(path.join(rootDir, 'rag-service/.coverage')) &&
    !isTrackedPath(rootDir, 'rag-service/.coverage')
  ) {
    blocked.push('rag-service/.coverage');
  }

  return Array.from(new Set(blocked)).sort();
}

function collectTrackedRuntimeResidues(rootDir) {
  const output = readTrackedFiles(rootDir);
  const files = String(output)
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  return files
    .filter((filePath) => TRACKED_RUNTIME_PATTERNS.some((pattern) => pattern.test(filePath)))
    .sort();
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

  const trackedRuntimeResidues = collectTrackedRuntimeResidues(process.cwd());
  if (trackedRuntimeResidues.length > 0) {
    // eslint-disable-next-line no-console
    console.error('[release-clean-check] FAIL: runtime residue tracked in git index');
    for (const relPath of trackedRuntimeResidues.slice(0, 120)) {
      // eslint-disable-next-line no-console
      console.error(` - tracked ${relPath}`);
    }
    if (trackedRuntimeResidues.length > 120) {
      // eslint-disable-next-line no-console
      console.error(` - ... e mais ${trackedRuntimeResidues.length - 120} caminho(s)`);
    }
    process.exit(1);
  }

  const runtimeResidues = collectRuntimeResidues(process.cwd());
  if (runtimeResidues.length > 0) {
    // eslint-disable-next-line no-console
    console.error('[release-clean-check] FAIL: runtime residue detected in workspace');
    for (const relPath of runtimeResidues) {
      // eslint-disable-next-line no-console
      console.error(` - runtime ${relPath}`);
    }
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`[release-clean-check] PASS allowedChanges=${lines.length} trackedRuntimeResidues=0 runtimeResidues=0`);
  process.exit(0);
}

main();
