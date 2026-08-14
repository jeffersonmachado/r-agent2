'use strict';

const path = require('path');
const { resolveRuntimePath } = require('../api/utils/runtimePaths');
const {
  normalizeJsonName,
  normalizeTenantKey,
  resolveContainedJsonPath,
} = require('./rpaSecurity');
const { tenantPathKey } = require('./artifactStore');

function uniquePaths(paths) {
  return Array.from(new Set((paths || []).filter(Boolean)));
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

function getTenantRuntimeRpaDir(tenantId, ...segments) {
  const scopedTenantId = normalizeTenantKey(tenantId);
  return getRuntimeRpaDir('tenants', tenantPathKey(scopedTenantId), ...segments);
}

function getRpaSeedWriteDir(tenantId = null) {
  return tenantId == null
    ? getRuntimeRpaDir('seeds')
    : getTenantRuntimeRpaDir(tenantId, 'seeds');
}

function getRpaFlowWriteDir(tenantId = null) {
  return tenantId == null
    ? getRuntimeRpaDir('flows')
    : getTenantRuntimeRpaDir(tenantId, 'flows');
}

function getRpaReplayDir(tenantId = null) {
  return tenantId == null
    ? getRuntimeRpaDir('replay')
    : getTenantRuntimeRpaDir(tenantId, 'replay');
}

function getRpaReportDir(tenantId = null) {
  return tenantId == null
    ? getRuntimeRpaDir('reports')
    : getTenantRuntimeRpaDir(tenantId, 'reports');
}

function getRpaSeedReadDirs(tenantId = null) {
  if (tenantId == null) {
    return uniquePaths([
      getRpaSeedWriteDir(),
      getLegacyProductRpaDir('seeds'),
      getLegacyTestsRpaDir('seeds'),
    ]);
  }
  const scopedTenantId = normalizeTenantKey(tenantId);
  return uniquePaths([
    getRpaSeedWriteDir(scopedTenantId),
    // Artefatos sem tenant são legado exclusivo do tenant system.
    ...(scopedTenantId === 'system' ? [
      getRpaSeedWriteDir(),
      getLegacyProductRpaDir('seeds'),
      getLegacyTestsRpaDir('seeds'),
    ] : []),
  ]);
}

function getRpaFlowReadDirs(tenantId = null) {
  if (tenantId == null) {
    return uniquePaths([getRpaFlowWriteDir(), getLegacyTestsRpaDir('flows')]);
  }
  const scopedTenantId = normalizeTenantKey(tenantId);
  return uniquePaths([
    getRpaFlowWriteDir(scopedTenantId),
    ...(scopedTenantId === 'system' ? [getRpaFlowWriteDir(), getLegacyTestsRpaDir('flows')] : []),
  ]);
}

function getRpaReplayReadDirs(tenantId = null) {
  if (tenantId == null) return uniquePaths([getRpaReplayDir(), getLegacyTestsRpaDir('replay')]);
  const scopedTenantId = normalizeTenantKey(tenantId);
  return uniquePaths([
    getRpaReplayDir(scopedTenantId),
    ...(scopedTenantId === 'system' ? [getRpaReplayDir(), getLegacyTestsRpaDir('replay')] : []),
  ]);
}

function getRpaReportReadDirs(tenantId = null) {
  if (tenantId == null) return uniquePaths([getRpaReportDir(), getLegacyTestsRpaDir('reports')]);
  const scopedTenantId = normalizeTenantKey(tenantId);
  return uniquePaths([
    getRpaReportDir(scopedTenantId),
    ...(scopedTenantId === 'system' ? [getRpaReportDir(), getLegacyTestsRpaDir('reports')] : []),
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

function getAllReplayReadDirs(tenantId = null) {
  // Combinar replays de QA Mesh (unificado) + legacy RPA
  return uniquePaths([
    ...getQaMeshReplayReadDirs(),
    ...getRpaReplayReadDirs(tenantId),
  ]);
}

function getRecordingSearchPaths(filename, tenantId = 'system') {
  const normalized = normalizeJsonName(filename);
  return uniquePaths([
    ...getRpaSeedReadDirs(tenantId).map((dirPath) => resolveContainedJsonPath(dirPath, normalized)),
    ...getRpaFlowReadDirs(tenantId).map((dirPath) => resolveContainedJsonPath(dirPath, normalized)),
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
  getTenantRuntimeRpaDir,
  getRuntimeRpaDir,
  normalizeJsonName,
  resolveContainedJsonPath,
  uniquePaths,
};
