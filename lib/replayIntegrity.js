'use strict';

const crypto = require('crypto');

const INTEGRITY_FIELDS = new Set([
  'replayHash',
  'replayChecksum',
  'governanceSignature',
  'integrity',
]);

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

let fallbackKeyWarningEmitted = false;

function resolveSigningKey(explicitKey = null, { required = true } = {}) {
  const dedicatedKey = explicitKey || process.env.REPLAY_SIGNING_KEY || '';
  const raw = dedicatedKey || process.env.ENCRYPTION_KEY || '';
  if (!dedicatedKey && raw && !fallbackKeyWarningEmitted) {
    // Separação de chaves: reusar ENCRYPTION_KEY para assinatura HMAC é
    // fallback de compatibilidade — operadores devem definir REPLAY_SIGNING_KEY.
    fallbackKeyWarningEmitted = true;
    try {
      require('../api/utils/logger').warn(
        '[ReplayIntegrity] REPLAY_SIGNING_KEY ausente; usando ENCRYPTION_KEY como fallback. Defina REPLAY_SIGNING_KEY dedicada (>= 32 bytes).'
      );
    } catch {
      // logger indisponível não pode impedir a assinatura
    }
  }
  const key = String(raw);
  if (Buffer.byteLength(key, 'utf8') < 32) {
    if (!required) return null;
    const error = new Error('replay_signing_key_required_min_32_bytes');
    error.code = 'REPLAY_SIGNING_KEY_REQUIRED';
    throw error;
  }
  return Buffer.from(key, 'utf8');
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

// Canonicalização sem descarte de campos: `stable()` remove as chaves de
// INTEGRITY_FIELDS (replayHash, replayChecksum, governanceSignature, integrity),
// o que é correto para hashear o ARTEFATO, mas destruía a mensagem assinada — o
// `replayHash` era removido e a assinatura passava a cobrir só a decisão,
// ficando portável entre artefatos e entre tenants.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => { acc[key] = canonical(value[key]); return acc; }, {});
}

function governanceMessage(replayHash, governance = {}, scope = {}) {
  return JSON.stringify(canonical({
    replayHash: replayHash || null,
    tenantId: scope.tenantId || null,
    environment: scope.environment || null,
    goNoGo: governance.goNoGo || governance.decision || null,
    isOperational: governance.isOperational === true,
    blockers: Array.isArray(governance.blockers) ? governance.blockers : [],
  }));
}

function computeGovernanceSignature(replay = {}, governance = {}, options = {}) {
  const key = resolveSigningKey(options.signingKey);
  const replayHash = computeReplayHash(replay);
  const signature = crypto.createHmac('sha256', key)
    .update(governanceMessage(replayHash, governance, {
      tenantId: replay.tenantId || null,
      environment: replay.environment || null,
    }), 'utf8')
    .digest('hex');
  return `hmac-sha256:${signature}`;
}

function signReplayArtifact(replay = {}, {
  governance = {},
  generatedAt = new Date().toISOString(),
  signedAt = new Date().toISOString(),
  tenantId = null,
  environment = null,
  smokeExecutionId = null,
  signingKey = null,
} = {}) {
  const key = resolveSigningKey(signingKey);
  const base = {
    ...replay,
    // A decisão de governança faz parte do payload imutável. Sem persistir o
    // mesmo objeto usado na assinatura, a validação posterior não consegue
    // reconstruir a mensagem HMAC e todo replay recém-gravado parece violado.
    governance: stable(governance),
    generatedAt: replay.generatedAt || generatedAt,
    signedAt,
    // Valores derivados pelo boundary prevalecem sobre conteúdo do artefato;
    // um payload não pode se autoatribuir a outro tenant/ambiente antes da
    // assinatura.
    tenantId: tenantId || replay.tenantId || null,
    environment: environment || replay.environment || null,
    smokeExecutionId: smokeExecutionId || replay.smokeExecutionId || null,
  };
  const replayHash = computeReplayHash(base);
  const replayChecksum = `sha256:${replayHash}`;
  const governanceSignature = computeGovernanceSignature(base, base.governance, { signingKey: key });
  const keyId = sha256(key).slice(0, 16);
  return {
    ...base,
    replayHash,
    replayChecksum,
    governanceSignature,
    integrity: {
      algorithm: 'sha256+hmac-sha256',
      signatureAlgorithm: 'hmac-sha256',
      keyId,
      immutable: true,
      retentionPolicy: 'qa-waves-prod-like-90d',
      signedAt,
      replayHash,
      replayChecksum,
      governanceSignature,
    },
  };
}

function validateReplayIntegrity(replay = {}, governance = {}, options = {}) {
  const blockers = [];
  const expectedHash = computeReplayHash(replay);
  const expectedChecksum = `sha256:${expectedHash}`;
  let expectedSignature = null;
  let signingKey = null;
  try {
    signingKey = resolveSigningKey(options.signingKey);
    expectedSignature = computeGovernanceSignature(replay, governance, { signingKey });
  } catch (error) {
    blockers.push({ reason: 'replay_signing_key_unavailable' });
  }

  if (!replay.replayHash) blockers.push({ reason: 'replay_hash_missing' });
  if (!replay.replayChecksum) blockers.push({ reason: 'replay_checksum_missing' });
  if (!replay.governanceSignature) blockers.push({ reason: 'governance_signature_missing' });
  if (replay.integrity?.signatureAlgorithm !== 'hmac-sha256') {
    blockers.push({ reason: 'governance_signature_algorithm_unsupported' });
  }
  if (replay.replayHash && replay.replayHash !== expectedHash) {
    blockers.push({ reason: 'replay_hash_mismatch', expected: expectedHash, actual: replay.replayHash });
  }
  if (replay.replayChecksum && replay.replayChecksum !== expectedChecksum) {
    blockers.push({ reason: 'replay_checksum_mismatch', expected: expectedChecksum, actual: replay.replayChecksum });
  }
  if (expectedSignature && replay.governanceSignature && replay.governanceSignature !== expectedSignature) {
    blockers.push({ reason: 'governance_signature_mismatch' });
  }

  const maxAgeMs = Number.isFinite(Number(options.maxAgeMs))
    ? Number(options.maxAgeMs)
    : Number(process.env.REPLAY_SIGNATURE_MAX_AGE_MS || DEFAULT_MAX_AGE_MS);
  const signedAt = replay.integrity?.signedAt || replay.signedAt || replay.generatedAt || null;
  const signedAtMs = signedAt ? new Date(signedAt).getTime() : NaN;
  if (!signedAt || !Number.isFinite(signedAtMs)) {
    blockers.push({ reason: 'replay_signature_timestamp_missing' });
  } else if (maxAgeMs >= 0 && Date.now() - signedAtMs > maxAgeMs) {
    blockers.push({ reason: 'replay_signature_stale', signedAt, maxAgeMs });
  } else if (signedAtMs - Date.now() > 5 * 60 * 1000) {
    blockers.push({ reason: 'replay_signature_from_future', signedAt });
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
  DEFAULT_MAX_AGE_MS,
  canonicalReplayPayload,
  computeGovernanceSignature,
  computeReplayChecksum,
  computeReplayHash,
  resolveSigningKey,
  signReplayArtifact,
  validateReplayIntegrity,
};
