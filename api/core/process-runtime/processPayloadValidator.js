'use strict';

const Ajv = require('ajv');

function safeClone(value) {
  if (value == null) return value;
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
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
        schema: safeClone(schema),
        error: 'resume_payload_invalid',
        details: buildValidationDetails(error),
      };
    }

    if (valid) {
      return { ok: true, schema: safeClone(schema), payload };
    }
    const ajvErrors = Array.isArray(validator.errors) ? validator.errors : [];
    return {
      ok: false,
      schema: safeClone(schema),
      error: 'resume_payload_invalid',
      details: ajvErrors.map((item) => {
        let path = '';
        let message = 'invalid';
        let keyword = null;
        try { path = item.instancePath || item.schemaPath || ''; } catch (_) { /* noop */ }
        try { message = item.message || 'invalid'; } catch (_) { /* noop */ }
        try { keyword = item.keyword || null; } catch (_) { /* noop */ }
        return { path, message, keyword };
      }),
    };
  }
}

module.exports = {
  ProcessPayloadValidator,
};
