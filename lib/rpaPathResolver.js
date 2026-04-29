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

function getQaMeshEvidenceDir(...segments) {
  return path.join(getWorkspaceRoot(), 'qa-mesh', 'meshEvidence', ...segments);
}

function getQaMeshReplayReadDirs() {
  // Procurar em todos os subdiretórios de qa-mesh/meshEvidence/*/replays/
  const fs = require('fs');
  const meshDir = getQaMeshEvidenceDir();
  const dirs = [];
  
  if (fs.existsSync(meshDir)) {
    try {
      const entries = fs.readdirSync(meshDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const replaySubdir = path.join(meshDir, entry.name, 'replays');
          if (fs.existsSync(replaySubdir)) {
            dirs.push(replaySubdir);
          }
        }
      }
    } catch (_) {
      // Ignorar erros ao ler diretório
    }
  }
  
  return dirs;
}

function getAllReplayReadDirs() {
  // Combinar replays de QA Mesh (unificado) + legacy RPA
  return uniquePaths([
    ...getQaMeshReplayReadDirs(),
    ...getRpaReplayReadDirs(),
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
  getAllReplayReadDirs,
  getLegacyTestsRpaDir,
  getQaMeshEvidenceDir,
  getQaMeshReplayReadDirs,
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