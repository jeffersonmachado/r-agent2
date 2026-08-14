'use strict';

const os = require('os');
const path = require('path');

function defaultRuntimeRoot(env) {
  if (env && env.NODE_ENV === 'production') return '/var/lib/ragent2';
  const home = env && env.HOME ? String(env.HOME).trim() : '';
  return home
    ? path.join(home, '.local', 'share', 'ragent2-runtime')
    : path.join(os.tmpdir(), 'ragent2-runtime');
}

const RUNTIME_ROOT_GLOBAL = Symbol.for('ragent2.runtimeRoot');

function configureRuntimeRoot(root) {
  if (root) {
    const resolved = path.isAbsolute(root) ? root : path.resolve(root);
    globalThis[RUNTIME_ROOT_GLOBAL] = resolved;
  } else {
    delete globalThis[RUNTIME_ROOT_GLOBAL];
  }
}

function configuredRootValue() {
  return globalThis[RUNTIME_ROOT_GLOBAL] || null;
}

function getRuntimeRoot(rootDir, env = process.env) {
  const configured = configuredRootValue();
  const raw = configured || defaultRuntimeRoot(env);
  const resolved = path.isAbsolute(raw) ? raw : path.join(rootDir, raw);
  const insideWorkspace = resolved === rootDir || resolved.startsWith(`${rootDir}${path.sep}`);
  if (insideWorkspace) {
    if (configured) {
      throw new Error('runtime root inválido: deve apontar para diretório externo ao workspace.');
    }
    return path.join(os.tmpdir(), 'ragent2-runtime');
  }
  return resolved;
}

function runtimeAwarePath(rootDir, defaultRelPath, explicitEnvVar, env = process.env) {
  if (explicitEnvVar && env[explicitEnvVar]) {
    return env[explicitEnvVar];
  }
  const runtimeRoot = getRuntimeRoot(rootDir, env);
  return path.join(runtimeRoot, defaultRelPath);
}

function resolveWorkspacePath(rootDir, targetPath) {
  if (!targetPath) {
    return rootDir;
  }
  return path.isAbsolute(targetPath) ? targetPath : path.join(rootDir, targetPath);
}

function resolveEvidenceCandidates(rootDir, targetPath, explicitEnvVar, env = process.env) {
  const candidates = [];
  let runtimeRoot = null;
  try {
    const resolved = configuredRootValue() || defaultRuntimeRoot(env);
    runtimeRoot = path.isAbsolute(resolved) ? resolved : path.join(rootDir, resolved);
  } catch (_) {
    runtimeRoot = null;
  }

  if (!targetPath && !(explicitEnvVar && env[explicitEnvVar])) {
    return candidates;
  }

  if (targetPath && path.isAbsolute(targetPath)) {
    candidates.push(targetPath);

    if (runtimeRoot && (targetPath === runtimeRoot || targetPath.startsWith(`${runtimeRoot}${path.sep}`))) {
      const relativeFromRuntime = path.relative(runtimeRoot, targetPath);
      candidates.push(path.join(rootDir, relativeFromRuntime));
    }
  } else {
    try {
      candidates.push(resolveWorkspacePath(rootDir, runtimeAwarePath(rootDir, targetPath, explicitEnvVar, env)));
    } catch (_) {}

    if (targetPath) {
      candidates.push(path.join(rootDir, targetPath));
    }
  }

  if (!targetPath && explicitEnvVar && env[explicitEnvVar]) {
    candidates.push(resolveWorkspacePath(rootDir, env[explicitEnvVar]));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

module.exports = {
  getRuntimeRoot,
  configureRuntimeRoot,
  configuredRootValue,
  runtimeAwarePath,
  resolveWorkspacePath,
  resolveEvidenceCandidates,
};