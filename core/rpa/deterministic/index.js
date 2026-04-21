'use strict';

const crypto = require('crypto');

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function createDeterministicExecution(recording = {}, options = {}) {
  const normalizedInput = stableStringify({
    recordingId: recording.id || recording.name || 'unknown-recording',
    tenantId: options.tenantId || options.data?.tenantId || recording?.metadata?.tenantId || 'system',
    data: options.data || {},
    seed: options.seed || null,
  });

  const seed = String(options.seed || process.env.RPA_DETERMINISTIC_SEED || hashValue(normalizedInput).slice(0, 16));
  const baseEpoch = Date.parse(process.env.RPA_FIXED_EPOCH || '2026-01-01T00:00:00.000Z');
  const offset = parseInt(hashValue(seed).slice(0, 8), 16) % 86400000;
  const stepMs = Number(process.env.RPA_DETERMINISTIC_STEP_MS || 137);
  let tick = 0;

  const clock = {
    next(label = 'tick') {
      const value = new Date(baseEpoch + offset + (tick * stepMs)).toISOString();
      tick += 1;
      return value;
    },
    peek() {
      return new Date(baseEpoch + offset + (tick * stepMs)).toISOString();
    },
  };

  function createId(prefix = 'rpa', suffix = '') {
    const fingerprint = hashValue(`${prefix}:${seed}:${suffix}`).slice(0, 12);
    return suffix ? `${prefix}-${fingerprint}-${suffix}` : `${prefix}-${fingerprint}`;
  }

  return {
    seed,
    tenantId: options.tenantId || options.data?.tenantId || recording?.metadata?.tenantId || 'system',
    baseTimestamp: new Date(baseEpoch + offset).toISOString(),
    normalizedInput,
    clock,
    createId,
    buildReplayName(recordingId) {
      return `${String(recordingId || recording.id || 'recording')}-${seed}`;
    },
    snapshot() {
      return {
        seed,
        tenantId: options.tenantId || options.data?.tenantId || recording?.metadata?.tenantId || 'system',
        baseTimestamp: new Date(baseEpoch + offset).toISOString(),
      };
    },
  };
}

module.exports = {
  createDeterministicExecution,
  hashValue,
  stableStringify,
};