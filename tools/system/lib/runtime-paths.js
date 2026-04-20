'use strict';

const path = require('path');

function getRuntimeRoot(rootDir, env = process.env) {
  const runtimeRoot = env.RUNTIME_ROOT;
  if (!runtimeRoot) {
    return null;
  }
  return path.isAbsolute(runtimeRoot) ? runtimeRoot : path.join(rootDir, runtimeRoot);
}

function runtimeAwarePath(rootDir, defaultRelPath, explicitEnvVar, env = process.env) {
  if (explicitEnvVar && env[explicitEnvVar]) {
    return env[explicitEnvVar];
  }
  const runtimeRoot = getRuntimeRoot(rootDir, env);
  if (!runtimeRoot) {
    return defaultRelPath;
  }
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