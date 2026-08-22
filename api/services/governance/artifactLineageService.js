'use strict';

const { getSequelize } = require('../../db/sequelize');
const getRuntimeArtifact = require('../../db/models/RuntimeArtifact');
const getGovernanceRun = require('../../db/models/GovernanceRun');

function error(code, message) { const err = new Error(`${code}: ${message}`); err.code = code; return err; }

async function registerArtifact({ runId, sourceFingerprint, tenantKey = 'system', artifactType, artifactVersion = '1.0.0', refId, sha256, sizeBytes = 0, storageKey = null, contentJsonb = null, producer, metadata = {}, immutable = true, status = 'RECORDED' }) {
  const sequelize = getSequelize(); if (!sequelize) throw error('governance_db_required', 'Sequelize não inicializado');
  if (!runId || !sourceFingerprint || !artifactType || !refId || !sha256 || !producer) throw error('artifact_lineage_incomplete', 'runId, sourceFingerprint, type, refId, sha256 e producer são obrigatórios');
  return sequelize.transaction(async (transaction) => {
    const Model = getRuntimeArtifact();
    const run = await getGovernanceRun().findOne({ where: { run_id: runId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!run) throw error('governance_run_not_found', runId);
    if (run.source_fingerprint !== sourceFingerprint) throw error('RUN_SOURCE_DRIFT', runId);
    return Model.create({ tenant_key: tenantKey, kind: artifactType, ref_id: refId, run_id: runId, artifact_type: artifactType, artifact_version: artifactVersion, source_fingerprint: sourceFingerprint, sha256, size_bytes: sizeBytes, storage_key: storageKey, content_jsonb: contentJsonb, producer, immutable, status, metadata }, { transaction });
  });
}

module.exports = { registerArtifact, error };