'use strict';

const fs = require('fs');
const os = require('os');
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

function defaultRuntimeRoot() {
  // Produção/containers: /var/lib/ragent2 (volume montado).
  // Dev: ~/.local/share/ragent2-runtime (persistente, fora do workspace).
  if (process.env.NODE_ENV === 'production') {
    return '/var/lib/ragent2';
  }
  const home = safeTrim(process.env.HOME) || os.homedir();
  return home
    ? path.join(home, '.local', 'share', 'ragent2-runtime')
    : path.join(os.tmpdir(), 'ragent2-runtime');
}

const RUNTIME_ROOT_GLOBAL = Symbol.for('ragent2.runtimeRoot');

/**
 * Override in-process do runtime root (usado por testes para isolamento).
 * Fica em `globalThis` (fora do registry de módulos) para sobreviver a
 * `jest.resetModules()`/`jest.isolateModules()`. Produção/dev não chamam
 * isto — usam o default computado.
 */
function configureRuntimeRoot(root) {
  if (root) {
    globalThis[RUNTIME_ROOT_GLOBAL] = path.resolve(String(root));
  } else {
    delete globalThis[RUNTIME_ROOT_GLOBAL];
  }
}

function resolveRuntimeRoot() {
  const explicit = globalThis[RUNTIME_ROOT_GLOBAL];
  let resolved = path.resolve(explicit || defaultRuntimeRoot());

  const workspaceRoot = path.resolve(process.cwd());
  const insideWorkspace = resolved === workspaceRoot || resolved.startsWith(`${workspaceRoot}${path.sep}`);

  if (insideWorkspace) {
    if (explicit) {
      throw new Error('runtime root inválido: deve ficar fora do workspace.');
    }
    // Default computado raro dentro do workspace: recai para tmpdir.
    resolved = path.resolve(path.join(os.tmpdir(), 'ragent2-runtime'));
  }

  return ensureDir(resolved);
}

function resolveRuntimePath(...segments) {
  return ensureDir(path.join(resolveRuntimeRoot(), ...segments.filter(Boolean)));
}

module.exports = {
  resolveRuntimeRoot,
  resolveRuntimePath,
  configureRuntimeRoot,
};
