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
  if (!explicit) {
    throw new Error('RUNTIME_ROOT é obrigatório. Configure um diretório externo ao workspace.');
  }

  const resolved = path.resolve(explicit);
  const workspaceRoot = path.resolve(process.cwd());
  if (resolved === workspaceRoot || resolved.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error('RUNTIME_ROOT inválido: o runtime deve ficar fora do workspace.');
  }

  return ensureDir(resolved);
}

function resolveRuntimePath(...segments) {
  return ensureDir(path.join(resolveRuntimeRoot(), ...segments.filter(Boolean)));
}

module.exports = {
  resolveRuntimeRoot,
  resolveRuntimePath,
};
