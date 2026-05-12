'use strict';

const path = require('path');

function getRuntimeRoot(rootDir, env = process.env) {
  const runtimeRoot = env.RUNTIME_ROOT;
  if (!runtimeRoot) {
    throw new Error('RUNTIME_ROOT é obrigatório para execução dos scripts oficiais.');
  }
  const resolved = path.isAbsolute(runtimeRoot) ? runtimeRoot : path.join(rootDir, runtimeRoot);
  if (resolved === rootDir || resolved.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error('RUNTIME_ROOT inválido: deve apontar para diretório externo ao workspace.');
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
  const runtimeRoot = env.RUNTIME_ROOT
    ? (path.isAbsolute(env.RUNTIME_ROOT) ? env.RUNTIME_ROOT : path.join(rootDir, env.RUNTIME_ROOT))
    : null;

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
  runtimeAwarePath,
  resolveWorkspacePath,
  resolveEvidenceCandidates,
};