'use strict';

const { getSequelize } = require('../../db/sequelize');
const { ProcessCompiledDefinition, Flow } = require('../../db/models');
const { compileCanonicalProcessDefinition } = require('./processCanonicalAdapter');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function dbAvailable() {
  return !!getSequelize();
}

class InMemoryProcessCompiledDefinitionRepository {
  constructor() {
    this._definitions = new Map();
  }

  buildKey({ tenantId = null, processId, processVersion = 1 }) {
    return `${String(tenantId || 'system')}::${String(processId || '')}::${Number(processVersion || 1)}`;
  }

  async saveCompiledProcess({ tenantId = null, compiledProcess, sourceDefinition = null, sourceType = 'compiled' } = {}) {
    if (!compiledProcess || !compiledProcess.id) return null;
    const key = this.buildKey({
      tenantId,
      processId: compiledProcess.id,
      processVersion: compiledProcess.version || 1,
    });
    const record = {
      tenantId: tenantId ? String(tenantId) : null,
      processId: String(compiledProcess.id),
      processVersion: Number(compiledProcess.version || 1),
      sourceType: String(sourceType || 'compiled'),
      sourceDefinition: clone(sourceDefinition || null),
      compiledDefinition: clone(compiledProcess),
      metadata: clone(compiledProcess.metadata || {}),
      updatedAt: new Date().toISOString(),
    };
    this._definitions.set(key, record);
    return clone(record);
  }

  async loadCompiledProcess({ tenantId = null, processId, processVersion = 1 } = {}) {
    const key = this.buildKey({ tenantId, processId, processVersion });
    const found = this._definitions.get(key);
    return found ? clone(found.compiledDefinition) : null;
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
    if (!compiledProcess || !compiledProcess.id) return null;
    const where = {
      tenant_key: tenantId ? String(tenantId) : null,
      process_id: String(compiledProcess.id),
      process_version: Number(compiledProcess.version || 1),
    };
    const payload = {
      id: `${String(tenantId || 'system')}::${String(compiledProcess.id)}::${Number(compiledProcess.version || 1)}`,
      tenant_key: where.tenant_key,
      process_id: where.process_id,
      process_version: where.process_version,
      source_type: String(sourceType || 'compiled'),
      source_definition: clone(sourceDefinition || null),
      compiled_definition: clone(compiledProcess),
      metadata: clone(compiledProcess.metadata || {}),
    };
    const existing = await this.model.findOne({ where });
    const row = existing
      ? await existing.update(payload)
      : await this.model.create(payload);
    const json = row.toJSON ? row.toJSON() : row;
    return clone(json.compiled_definition || compiledProcess);
  }

  async loadCompiledProcess({ tenantId = null, processId, processVersion = 1 } = {}) {
    if (!dbAvailable()) {
      return this._fallback.loadCompiledProcess({ tenantId, processId, processVersion });
    }
    const where = {
      process_id: String(processId || ''),
      process_version: Number(processVersion || 1),
    };
    if (tenantId != null) {
      where.tenant_key = String(tenantId);
    }

    const row = await this.model.findOne({
      where,
      order: [['updated_at', 'DESC']],
    });
    if (row) {
      const json = row.toJSON ? row.toJSON() : row;
      return clone(json.compiled_definition || null);
    }

    const flowModel = Flow();
    const flowRow = await flowModel.findOne({
      where: tenantId != null
        ? { tenant_key: String(tenantId), id: String(processId || '') }
        : { id: String(processId || '') },
      order: [['updated_at', 'DESC']],
    });
    if (!flowRow) return null;
    const flow = flowRow.toJSON ? flowRow.toJSON() : flowRow;
    const data = flow.data && typeof flow.data === 'object' ? flow.data : {};
    const compiledFromFlow = data?.durableRuntime?.compiledProcess
      || data?.compiledProcess
      || null;
    if (compiledFromFlow) {
      return clone(compiledFromFlow);
    }
    if (data && Array.isArray(data.nodes)) {
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
