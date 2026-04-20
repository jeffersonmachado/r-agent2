'use strict';

const fs = require('fs');
const path = require('path');

function safeTrim(value) {
  if (value == null) return '';
  try {
    return String(value).trim();
  } catch (_) {
    return '';
  }
}

function ensureDir(absPath) {
  try {
    fs.mkdirSync(absPath, { recursive: true });
  } catch (_) {
    // best effort
  }
  return absPath;
}

function hasPath(absPath) {
  try {
    return fs.existsSync(absPath);
  } catch (_) {
    return false;
  }
}

function resolveRuntimeRoot() {
  const explicit = safeTrim(process.env.RUNTIME_ROOT);
  if (explicit) return ensureDir(path.resolve(explicit));

  const systemBase = '/var/lib/ragent2';
  if (hasPath(systemBase)) {
    return ensureDir(path.join(systemBase, 'runtime'));
  }

  const home = safeTrim(process.env.HOME);
  if (home) {
    return ensureDir(path.join(home, '.ragent2', 'runtime'));
  }

  return ensureDir(path.resolve(process.cwd(), 'runtime'));
}

function resolveRuntimePath(...segments) {
  return ensureDir(path.join(resolveRuntimeRoot(), ...segments.filter(Boolean)));
}

module.exports = {
  resolveRuntimeRoot,
  resolveRuntimePath,
};
