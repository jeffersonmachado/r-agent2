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

module.exports = {
  getRuntimeRoot,
  runtimeAwarePath,
  resolveWorkspacePath,
};