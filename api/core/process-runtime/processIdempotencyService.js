'use strict';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class InMemoryProcessIdempotencyService {
  constructor({ instanceStore } = {}) {
    this._records = new Map();
    this._instanceStore = instanceStore || null;
  }

  buildKey({ executionId, nodeId, sequence = 0 }) {
    return `${String(executionId || '')}:${String(nodeId || '')}:${Number(sequence || 0)}`;
  }

  async getRecord(key, params = {}) {
    const normalizedKey = String(key || '');
    if (this._records.has(normalizedKey)) {
      return clone(this._records.get(normalizedKey));
    }
    if (!this._instanceStore || !params.executionId) {
      return null;
    }
    const instance = await this._instanceStore.loadInstance(params.executionId);
    const persisted = instance?.metadata?.idempotencyRecords?.[normalizedKey];
    if (persisted == null) return null;
    this._records.set(normalizedKey, clone(persisted));
    return clone(persisted);
  }

  async saveRecord(key, value, params = {}) {
    const normalizedKey = String(key || '');
    const normalizedValue = clone(value);
    this._records.set(normalizedKey, normalizedValue);

    if (this._instanceStore && params.executionId) {
      const instance = await this._instanceStore.loadInstance(params.executionId);
      if (instance) {
        await this._instanceStore.updateInstance(params.executionId, {
          metadata: {
            ...(instance.metadata || {}),
            idempotencyRecords: {
              ...((instance.metadata && instance.metadata.idempotencyRecords) || {}),
              [normalizedKey]: normalizedValue,
            },
          },
        });
      }
    }

    return clone(normalizedValue);
  }

  async runOnce(params, executor) {
    const key = this.buildKey(params);
    const existing = await this.getRecord(key, params);
    if (existing) {
      return {
        reused: true,
        key,
        value: existing,
      };
    }
    const value = await executor();
    await this.saveRecord(key, value, params);
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
