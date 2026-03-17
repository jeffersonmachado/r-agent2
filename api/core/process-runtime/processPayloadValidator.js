'use strict';

const Ajv = require('ajv');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isObjectRecord(value) {
  return !!(value && typeof value === 'object');
}

function safeGet(value, key) {
  try {
    return value?.[key];
  } catch (_) {
    return undefined;
  }
}

function safeHasKeys(value) {
  if (!isObjectRecord(value)) return false;
  try {
    return Object.keys(value).length > 0;
  } catch (_) {
    return false;
  }
}

function buildValidationDetails(error) {
  if (!error) {
    return [{ path: '', message: 'invalid', keyword: null }];
  }
  return [{
    path: '',
    message: error.message || String(error),
    keyword: error.code || 'validation_exception',
  }];
}

class ProcessPayloadValidator {
  constructor() {
    this._ajv = new Ajv({ allErrors: true, strict: false });
    this._cache = new WeakMap();
  }

  getSchema(node = null, waitingState = null) {
    const waitingMetadata = safeGet(waitingState, 'metadata');
    const waitingResumeSchema = safeGet(waitingMetadata, 'resumeSchema');
    if (isObjectRecord(waitingResumeSchema)) {
      return waitingResumeSchema;
    }
    const nodeConfig = safeGet(node, 'config');
    const nodeResumeSchema = safeGet(nodeConfig, 'resumeSchema');
    if (isObjectRecord(nodeResumeSchema)) {
      return nodeResumeSchema;
    }
    const inputSchema = safeGet(node, 'inputSchema');
    if (safeHasKeys(inputSchema)) {
      return inputSchema;
    }
    return null;
  }

  validatePayload({ node = null, waitingState = null, payload = {} } = {}) {
    const schema = this.getSchema(node, waitingState);
    if (!schema) {
      return { ok: true, schema: null, payload };
    }
    let validator = this._cache.get(schema) || null;
    if (!validator) {
      try {
        validator = this._ajv.compile(schema);
        this._cache.set(schema, validator);
      } catch (error) {
        return {
          ok: false,
          schema: null,
          error: 'resume_schema_invalid',
          details: buildValidationDetails(error),
        };
      }
    }

    let valid = false;
    try {
      valid = validator(payload);
    } catch (error) {
      return {
        ok: false,
        schema: clone(schema),
        error: 'resume_payload_invalid',
        details: buildValidationDetails(error),
      };
    }

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
