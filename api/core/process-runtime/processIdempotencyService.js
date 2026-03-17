'use strict';

function clone(value) {
  return safeClone(value, value == null ? value : null);
}

function safeClone(value, fallbackValue = null) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallbackValue;
  }
}

function safeGet(value, key, fallbackValue = undefined) {
  try {
    const result = value?.[key];
    return result === undefined ? fallbackValue : result;
  } catch (_) {
    return fallbackValue;
  }
}

function safeToString(value, fallbackValue = '') {
  try {
    return String(value);
  } catch (_) {
    return fallbackValue;
  }
}

function safeFiniteNumber(value, fallbackValue = 0) {
  try {
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : fallbackValue;
  } catch (_) {
    return fallbackValue;
  }
}

function safeShallowCloneRecord(value) {
  if (!value || typeof value !== 'object') return {};
  try {
    return { ...value };
  } catch (_) {
    return {};
  }
}

class InMemoryProcessIdempotencyService {
  constructor({ instanceStore } = {}) {
    this._records = new Map();
    this._instanceStore = instanceStore || null;
  }

  buildKey({ executionId, nodeId, sequence = 0 }) {
    const safeExecutionId = safeToString(executionId || '', '');
    const safeNodeId = safeToString(nodeId || '', '');
    const safeSequence = safeFiniteNumber(sequence || 0, 0);
    return `${safeExecutionId}:${safeNodeId}:${safeSequence}`;
  }

  async getRecord(key, params = {}) {
    const safeParams = safeShallowCloneRecord(params);
    const normalizedKey = safeToString(key || '', '');
    if (this._records.has(normalizedKey)) {
      return clone(this._records.get(normalizedKey));
    }
    const executionId = safeToString(safeGet(safeParams, 'executionId', ''), '');
    if (!this._instanceStore || !executionId) {
      return null;
    }
    const instance = await this._instanceStore.loadInstance(executionId);
    const metadata = safeGet(instance, 'metadata', null);
    const idempotencyRecords = safeGet(metadata, 'idempotencyRecords', null);
    const persisted = safeGet(idempotencyRecords, normalizedKey, null);
    if (persisted == null) return null;
    const persistedClone = safeClone(persisted, null);
    this._records.set(normalizedKey, persistedClone);
    return clone(persistedClone);
  }

  async saveRecord(key, value, params = {}) {
    const safeParams = safeShallowCloneRecord(params);
    const normalizedKey = safeToString(key || '', '');
    const normalizedValue = safeClone(value, null);
    this._records.set(normalizedKey, normalizedValue);

    const executionId = safeToString(safeGet(safeParams, 'executionId', ''), '');
    if (this._instanceStore && executionId) {
      const instance = await this._instanceStore.loadInstance(executionId);
      if (instance) {
        const metadata = safeShallowCloneRecord(safeGet(instance, 'metadata', null));
        const idempotencyRecords = safeShallowCloneRecord(safeGet(metadata, 'idempotencyRecords', null));
        await this._instanceStore.updateInstance(executionId, {
          metadata: {
            ...metadata,
            idempotencyRecords: {
              ...idempotencyRecords,
              [normalizedKey]: normalizedValue,
            },
          },
        });
      }
    }

    return clone(normalizedValue);
  }

  async runOnce(params, executor) {
    const safeParams = safeShallowCloneRecord(params);
    const key = this.buildKey(safeParams);
    const existing = await this.getRecord(key, safeParams);
    if (existing) {
      return {
        reused: true,
        key,
        value: existing,
      };
    }
    const value = await executor();
    await this.saveRecord(key, value, safeParams);
    return {
      reused: false,
      key,
      value: clone(value),
    };
  }
}

module.exports = {
  InMemoryProcessIdempotencyService,
};
