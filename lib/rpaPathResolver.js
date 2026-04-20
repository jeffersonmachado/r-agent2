'use strict';

const path = require('path');
const { resolveRuntimePath } = require('../api/utils/runtimePaths');

function uniquePaths(paths) {
  return Array.from(new Set((paths || []).filter(Boolean)));
}

function normalizeJsonName(filename) {
  return String(filename || '').replace(/\.json$/i, '');
}

function getWorkspaceRoot() {
  return path.resolve(process.cwd());
}

function getLegacyTestsRpaDir(...segments) {
  return path.join(getWorkspaceRoot(), 'tests', 'rpa', ...segments);
}

function getLegacyProductRpaDir(...segments) {
  return path.join(getWorkspaceRoot(), 'rpa', ...segments);
}

function getRuntimeRpaDir(...segments) {
  return resolveRuntimePath('rpa', ...segments);
}

function getRpaSeedWriteDir() {
  return getRuntimeRpaDir('seeds');
}

function getRpaFlowWriteDir() {
  return getRuntimeRpaDir('flows');
}

function getRpaReplayDir() {
  return getRuntimeRpaDir('replay');
}

function getRpaReportDir() {
  return getRuntimeRpaDir('reports');
}

function getRpaSeedReadDirs() {
  return uniquePaths([
    getRpaSeedWriteDir(),
    getLegacyProductRpaDir('seeds'),
    getLegacyTestsRpaDir('seeds'),
  ]);
}

function getRpaFlowReadDirs() {
  return uniquePaths([
    getRpaFlowWriteDir(),
    getLegacyTestsRpaDir('flows'),
  ]);
}

function getRpaReplayReadDirs() {
  return uniquePaths([
    getRpaReplayDir(),
    getLegacyTestsRpaDir('replay'),
  ]);
}

function getRpaReportReadDirs() {
  return uniquePaths([
    getRpaReportDir(),
    getLegacyTestsRpaDir('reports'),
  ]);
}

function getRecordingSearchPaths(filename) {
  const normalized = normalizeJsonName(filename);
  return uniquePaths([
    ...getRpaSeedReadDirs().map((dirPath) => path.join(dirPath, `${normalized}.json`)),
    ...getRpaFlowReadDirs().map((dirPath) => path.join(dirPath, `${normalized}.json`)),
  ]);
}

module.exports = {
  getLegacyTestsRpaDir,
  getRecordingSearchPaths,
  getRpaFlowReadDirs,
  getRpaFlowWriteDir,
  getRpaReportDir,
  getRpaReportReadDirs,
  getRpaReplayDir,
  getRpaReplayReadDirs,
  getRpaSeedReadDirs,
  getRpaSeedWriteDir,
  getRuntimeRpaDir,
  normalizeJsonName,
  uniquePaths,
};