'use strict';

const { validateRunContext, isSha256 } = require('./run-context');

const REQUIRED_LINEAGE_FIELDS = Object.freeze([
  'runId',
  'sourceFingerprint',
  'generatedAt',
  'artifactType',
  'artifactVersion',
]);

function validateArtifactLineage(artifact, runContext) {
  const runValidation = validateRunContext(runContext);
  if (!runValidation.valid) {
    return { valid: false, code: 'INVALID_RUN_CONTEXT', reason: runValidation.reason };
  }
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return { valid: false, code: 'INVALID_ARTIFACT', reason: 'artifact must be an object' };
  }
  const missing = REQUIRED_LINEAGE_FIELDS.filter(
    (field) => artifact[field] == null || artifact[field] === '',
  );
  if (missing.length > 0) {
    return {
      valid: false,
      code: 'INVALID_ARTIFACT',
      reason: `missing lineage fields: ${missing.join(', ')}`,
      missing,
    };
  }
  if (artifact.runId !== runContext.runId) {
    return {
      valid: false,
      code: 'FOREIGN_RUN_ARTIFACT',
      reason: `artifact runId ${artifact.runId} differs from ${runContext.runId}`,
    };
  }
  if (!isSha256(artifact.sourceFingerprint)) {
    return { valid: false, code: 'INVALID_ARTIFACT', reason: 'sourceFingerprint must be a full SHA-256' };
  }
  if (artifact.sourceFingerprint !== runContext.sourceFingerprint) {
    return {
      valid: false,
      code: 'ARTIFACT_SOURCE_MISMATCH',
      reason: `artifact sourceFingerprint differs from frozen run source`,
    };
  }
  const generatedAt = Date.parse(artifact.generatedAt);
  const startedAt = Date.parse(runContext.startedAt);
  if (Number.isNaN(generatedAt)) {
    return { valid: false, code: 'INVALID_ARTIFACT', reason: 'generatedAt must be an ISO timestamp' };
  }
  if (!Number.isNaN(startedAt) && generatedAt < startedAt) {
    return { valid: false, code: 'STALE_ARTIFACT', reason: 'artifact predates the certification run' };
  }
  if (typeof artifact.artifactType !== 'string' || !artifact.artifactType.trim()) {
    return { valid: false, code: 'INVALID_ARTIFACT', reason: 'artifactType must be non-empty' };
  }
  if (typeof artifact.artifactVersion !== 'string' || !artifact.artifactVersion.trim()) {
    return { valid: false, code: 'INVALID_ARTIFACT', reason: 'artifactVersion must be non-empty' };
  }
  return {
    valid: true,
    code: 'CURRENT_RUN_ARTIFACT',
    runId: artifact.runId,
    sourceFingerprint: artifact.sourceFingerprint,
  };
}

function assertArtifactLineage(artifact, runContext, label = 'artifact') {
  const result = validateArtifactLineage(artifact, runContext);
  if (!result.valid) {
    const error = new Error(`${result.code}: ${label}: ${result.reason}`);
    error.code = result.code;
    error.details = result;
    throw error;
  }
  return result;
}

module.exports = {
  REQUIRED_LINEAGE_FIELDS,
  validateArtifactLineage,
  assertArtifactLineage,
};
