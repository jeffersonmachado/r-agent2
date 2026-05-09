'use strict';

const crypto = require('crypto');

const INTEGRITY_FIELDS = new Set([
  'replayHash',
  'replayChecksum',
  'governanceSignature',
  'integrity',
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .filter((key) => !INTEGRITY_FIELDS.has(key))
    .sort()
    .reduce((acc, key) => {
      acc[key] = stable(value[key]);
      return acc;
    }, {});
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function canonicalReplayPayload(replay = {}) {
  return JSON.stringify(stable(replay));
}

function computeReplayHash(replay = {}) {
  return sha256(canonicalReplayPayload(replay));
}

function computeReplayChecksum(replay = {}) {
  return `sha256:${computeReplayHash(replay)}`;
}

function computeGovernanceSignature(replay = {}, governance = {}) {
  const replayHash = computeReplayHash(replay);
  const governancePayload = JSON.stringify(stable({
    replayHash,
    goNoGo: governance.goNoGo || governance.decision || null,
    isOperational: governance.isOperational === true,
    blockers: Array.isArray(governance.blockers) ? governance.blockers : [],
  }));
  return `gov-sha256:${sha256(governancePayload)}`;
}

function signReplayArtifact(replay = {}, {
  governance = {},
  generatedAt = new Date().toISOString(),
  tenantId = null,
  environment = null,
  smokeExecutionId = null,
} = {}) {
  const base = {
    ...replay,
    generatedAt: replay.generatedAt || generatedAt,
    tenantId: replay.tenantId || tenantId,
    environment: replay.environment || environment,
    smokeExecutionId: replay.smokeExecutionId || smokeExecutionId,
  };
  const replayHash = computeReplayHash(base);
  const replayChecksum = `sha256:${replayHash}`;
  const governanceSignature = computeGovernanceSignature(base, governance);
  return {
    ...base,
    replayHash,
    replayChecksum,
    governanceSignature,
    integrity: {
      algorithm: 'sha256',
      immutable: true,
      retentionPolicy: 'qa-waves-prod-like-90d',
      replayHash,
      replayChecksum,
      governanceSignature,
    },
  };
}

function validateReplayIntegrity(replay = {}, governance = {}) {
  const blockers = [];
  const expectedHash = computeReplayHash(replay);
  const expectedChecksum = `sha256:${expectedHash}`;
  const expectedSignature = computeGovernanceSignature(replay, governance);

  if (!replay.replayHash) blockers.push({ reason: 'replay_hash_missing' });
  if (!replay.replayChecksum) blockers.push({ reason: 'replay_checksum_missing' });
  if (!replay.governanceSignature) blockers.push({ reason: 'governance_signature_missing' });
  if (replay.replayHash && replay.replayHash !== expectedHash) {
    blockers.push({ reason: 'replay_hash_mismatch', expected: expectedHash, actual: replay.replayHash });
  }
  if (replay.replayChecksum && replay.replayChecksum !== expectedChecksum) {
    blockers.push({ reason: 'replay_checksum_mismatch', expected: expectedChecksum, actual: replay.replayChecksum });
  }
  if (replay.governanceSignature && replay.governanceSignature !== expectedSignature) {
    blockers.push({ reason: 'governance_signature_mismatch', expected: expectedSignature, actual: replay.governanceSignature });
  }

  return {
    valid: blockers.length === 0,
    replayHash: expectedHash,
    replayChecksum: expectedChecksum,
    governanceSignature: expectedSignature,
    blockers,
  };
}

module.exports = {
  canonicalReplayPayload,
  computeReplayHash,
  computeReplayChecksum,
  computeGovernanceSignature,
  signReplayArtifact,
  validateReplayIntegrity,
};
