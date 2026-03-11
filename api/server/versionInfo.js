'use strict';

const fs = require('fs');
const path = require('path');

const SERVER_API_VERSION = '0.1.28';

function resolveApiVersionInfo({
  apiName = process.env.API_NAME || 'chatbot-engine-api',
  serverVersion = SERVER_API_VERSION,
} = {}) {
  const packagePath = path.resolve(__dirname, '..', '..', 'package.json');
  let packageJson = null;

  try {
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  } catch (_) {}

  const packageVersion = String(packageJson?.version || '0.0.0');
  const baseVersion = String(serverVersion || '0.0.0');
  const commit = String(
    process.env.GIT_COMMIT
    || process.env.GITHUB_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || ''
  ).trim();
  const build = String(process.env.BUILD_ID || process.env.CI_PIPELINE_ID || '').trim();
  const version = commit ? `${baseVersion}+${commit.slice(0, 7)}` : baseVersion;

  return {
    name: String(apiName),
    version,
    baseVersion,
    serverVersion: baseVersion,
    packageVersion,
    versionMismatch: packageVersion !== baseVersion,
    commit: commit || null,
    build: build || null,
  };
}

module.exports = {
  SERVER_API_VERSION,
  resolveApiVersionInfo,
};
