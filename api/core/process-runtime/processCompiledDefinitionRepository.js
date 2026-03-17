'use strict';

const { getSequelize } = require('../../db/sequelize');
const { ProcessCompiledDefinition, Flow } = require('../../db/models');
const { compileCanonicalProcessDefinition } = require('./processCanonicalAdapter');

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

function safeToJSON(value, fallbackValue = null) {
  if (!value) return fallbackValue;
  try {
    return value.toJSON ? value.toJSON() : value;
  } catch (_) {
    return fallbackValue;
  }
}

function normalizeCompiledProcess(compiledProcess) {
  const safeProcess = safeShallowCloneRecord(compiledProcess);
  const processId = safeToString(safeGet(safeProcess, 'id', ''), '');
  if (!processId) return null;
  const processVersion = safeFiniteNumber(safeGet(safeProcess, 'version', 1), 1);
  const metadata = safeClone(safeGet(safeProcess, 'metadata', {}), {}) || {};
  const normalized = {
    ...safeProcess,
    id: processId,
    version: processVersion,
    metadata,
  };
  return safeClone(normalized, {
    id: processId,
    version: processVersion,
    metadata,
  });
}

function dbAvailable() {
  return !!getSequelize();
}

class InMemoryProcessCompiledDefinitionRepository {
  constructor() {
    this._definitions = new Map();
  }

  buildKey({ tenantId = null, processId, processVersion = 1 }) {
    const safeTenantId = tenantId ? safeToString(tenantId, 'system') : 'system';
    const safeProcessId = safeToString(processId || '', '');
    const safeProcessVersion = safeFiniteNumber(processVersion || 1, 1);
    return `${safeTenantId}::${safeProcessId}::${safeProcessVersion}`;
  }

  async saveCompiledProcess({ tenantId = null, compiledProcess, sourceDefinition = null, sourceType = 'compiled' } = {}) {
    const safeCompiled = normalizeCompiledProcess(compiledProcess);
    if (!safeCompiled) return null;
    const safeProcessId = safeToString(safeGet(safeCompiled, 'id', ''), '');
    const safeProcessVersion = safeFiniteNumber(safeGet(safeCompiled, 'version', 1), 1);
    const key = this.buildKey({
      tenantId,
      processId: safeProcessId,
      processVersion: safeProcessVersion,
    });
    const record = {
      tenantId: tenantId ? safeToString(tenantId, null) : null,
      processId: safeProcessId,
      processVersion: safeProcessVersion,
      sourceType: safeToString(sourceType || 'compiled', 'compiled') || 'compiled',
      sourceDefinition: safeClone(sourceDefinition || null, null),
      compiledDefinition: safeClone(safeCompiled, {
        id: safeProcessId,
        version: safeProcessVersion,
        metadata: safeClone(safeGet(safeCompiled, 'metadata', {}), {}) || {},
      }),
      metadata: safeClone(safeGet(safeCompiled, 'metadata', {}), {}) || {},
      updatedAt: new Date().toISOString(),
    };
    this._definitions.set(key, record);
    return clone(record);
  }

  async loadCompiledProcess({ tenantId = null, processId, processVersion = 1 } = {}) {
    const key = this.buildKey({ tenantId, processId, processVersion });
    const found = this._definitions.get(key);
    return found ? safeClone(safeGet(found, 'compiledDefinition', null), null) : null;
  }
}

class SequelizeProcessCompiledDefinitionRepository {
  constructor() {
    this._fallback = new InMemoryProcessCompiledDefinitionRepository();
  }

  get model() {
    return ProcessCompiledDefinition();
  }

  async saveCompiledProcess({ tenantId = null, compiledProcess, sourceDefinition = null, sourceType = 'compiled' } = {}) {
    if (!dbAvailable()) {
      return this._fallback.saveCompiledProcess({ tenantId, compiledProcess, sourceDefinition, sourceType });
    }
    const safeCompiled = normalizeCompiledProcess(compiledProcess);
    if (!safeCompiled) return null;
    const safeProcessId = safeToString(safeGet(safeCompiled, 'id', ''), '');
    const safeProcessVersion = safeFiniteNumber(safeGet(safeCompiled, 'version', 1), 1);
    const where = {
      tenant_key: tenantId ? safeToString(tenantId, null) : null,
      process_id: safeProcessId,
      process_version: safeProcessVersion,
    };
    const payload = {
      id: `${safeToString(tenantId || 'system', 'system')}::${safeProcessId}::${safeProcessVersion}`,
      tenant_key: where.tenant_key,
      process_id: where.process_id,
      process_version: where.process_version,
      source_type: safeToString(sourceType || 'compiled', 'compiled') || 'compiled',
      source_definition: safeClone(sourceDefinition || null, null),
      compiled_definition: safeClone(safeCompiled, {
        id: safeProcessId,
        version: safeProcessVersion,
        metadata: safeClone(safeGet(safeCompiled, 'metadata', {}), {}) || {},
      }),
      metadata: safeClone(safeGet(safeCompiled, 'metadata', {}), {}) || {},
    };
    const existing = await this.model.findOne({ where });
    const row = existing
      ? await existing.update(payload)
      : await this.model.create(payload);
    const json = safeToJSON(row, {}) || {};
    return safeClone(safeGet(json, 'compiled_definition', safeCompiled), safeCompiled);
  }

  async loadCompiledProcess({ tenantId = null, processId, processVersion = 1 } = {}) {
    if (!dbAvailable()) {
      return this._fallback.loadCompiledProcess({ tenantId, processId, processVersion });
    }
    const where = {
      process_id: safeToString(processId || '', ''),
      process_version: safeFiniteNumber(processVersion || 1, 1),
    };
    if (tenantId != null) {
      where.tenant_key = safeToString(tenantId, '');
    }

    const row = await this.model.findOne({
      where,
      order: [['updated_at', 'DESC']],
    });
    if (row) {
      const json = safeToJSON(row, {}) || {};
      return safeClone(safeGet(json, 'compiled_definition', null), null);
    }

    const flowModel = Flow();
    const flowRow = await flowModel.findOne({
      where: tenantId != null
        ? { tenant_key: safeToString(tenantId, ''), id: safeToString(processId || '', '') }
        : { id: safeToString(processId || '', '') },
      order: [['updated_at', 'DESC']],
    });
    if (!flowRow) return null;
    const flow = safeToJSON(flowRow, {}) || {};
    const data = (safeGet(flow, 'data') && typeof safeGet(flow, 'data') === 'object') ? safeGet(flow, 'data') : {};
    const durableRuntime = safeGet(data, 'durableRuntime', {});
    const compiledFromFlow = safeGet(durableRuntime, 'compiledProcess', null)
      || safeGet(data, 'compiledProcess', null)
      || null;
    if (compiledFromFlow) {
      return safeClone(compiledFromFlow, null);
    }
    if (Array.isArray(safeGet(data, 'nodes', []))) {
      try {
        return compileCanonicalProcessDefinition(data);
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

module.exports = {
  InMemoryProcessCompiledDefinitionRepository,
  SequelizeProcessCompiledDefinitionRepository,
};
