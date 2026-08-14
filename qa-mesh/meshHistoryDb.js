'use strict';

/**
 * Espelhamento opcional do histórico de execução do QA Mesh no Postgres.
 *
 * Dual-write: o JSON em `qa-mesh/meshHistory/` continua sendo a fonte
 * canônica lida pelo `validate-coverage-gate` em CI (reprodutível e
 * versionada). Quando `MESH_HISTORY_DB=1`, a mesma execução é espelhada em
 * `runtime_artifacts` (kind `mesh/history`) via artifactStore postgres.
 */

const { createArtifactStore } = require('../lib/artifactStore');

function isEnabled() {
  return ['1', 'true', 'on'].includes(String(process.env.MESH_HISTORY_DB || '').trim().toLowerCase());
}

async function mirrorExecution(execution, deps = {}) {
  if (!isEnabled()) return null;
  if (!execution || !execution.executionId) {
    throw new Error('mesh_history_execution_id_required');
  }
  const store = deps.store || createArtifactStore({ backend: 'postgres' });
  const refId = String(execution.executionId);
  return store.write({
    kind: 'mesh/history',
    refId,
    tenantKey: String(execution.tenantId || 'system'),
    payload: execution,
  });
}

module.exports = {
  isEnabled,
  mirrorExecution,
};
