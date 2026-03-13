'use strict';

const Ajv = require('ajv');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class ProcessPayloadValidator {
  constructor() {
    this._ajv = new Ajv({ allErrors: true, strict: false });
    this._cache = new Map();
  }

  getSchema(node = null, waitingState = null) {
    if (waitingState?.metadata?.resumeSchema && typeof waitingState.metadata.resumeSchema === 'object') {
      return waitingState.metadata.resumeSchema;
    }
    if (node?.config?.resumeSchema && typeof node.config.resumeSchema === 'object') {
      return node.config.resumeSchema;
    }
    if (node?.inputSchema && typeof node.inputSchema === 'object' && Object.keys(node.inputSchema).length > 0) {
      return node.inputSchema;
    }
    return null;
  }

  validatePayload({ node = null, waitingState = null, payload = {} } = {}) {
    const schema = this.getSchema(node, waitingState);
    if (!schema) {
      return { ok: true, schema: null, payload };
    }
    const cacheKey = JSON.stringify(schema);
    let validator = this._cache.get(cacheKey) || null;
    if (!validator) {
      validator = this._ajv.compile(schema);
      this._cache.set(cacheKey, validator);
    }
    const valid = validator(payload);
    if (valid) {
      return { ok: true, schema: clone(schema), payload };
    }
    return {
      ok: false,
      schema: clone(schema),
      error: 'resume_payload_invalid',
      details: (validator.errors || []).map((item) => ({
        path: item.instancePath || item.schemaPath || '',
        message: item.message || 'invalid',
        keyword: item.keyword || null,
      })),
    };
  }
}

module.exports = {
  ProcessPayloadValidator,
};
