'use strict';

const { createProcessInstance, createWaitingState, PROCESS_INSTANCE_STATUSES } = require('./processInstanceTypes');
const { getSequelize } = require('../../db/sequelize');
const { Execution } = require('../../db/models');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

function safeNumber(value, fallbackValue = 0) {
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : fallbackValue;
}

function safeHasOwn(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch (_) {
    return false;
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

function normalizeFilterString(value) {
  if (value == null) return null;
  const normalized = safeToString(value, '');
  return normalized || null;
}

function resolveFilterString(filters, key) {
  if (!safeHasOwn(filters, key)) return null;
  const rawValue = safeGet(filters, key, null);
  // null/undefined explícitos significam "filtro ausente" — a rota de
  // listagem sempre envia as chaves com null quando o parâmetro não vem
  // na query. Converter para '' faria matchesInstanceFilters comparar
  // contra string vazia e excluir todos os registros.
  if (rawValue == null) return null;
  return safeToString(rawValue, '');
}

function sanitizeWaitingState(waitingState) {
  if (!waitingState || typeof waitingState !== 'object') return null;
  const normalized = {
    type: normalizeFilterString(safeGet(waitingState, 'type')),
    resumeAt: safeGet(waitingState, 'resumeAt', null),
    correlationKey: normalizeFilterString(safeGet(waitingState, 'correlationKey')),
    externalRef: normalizeFilterString(safeGet(waitingState, 'externalRef')),
    nodeId: normalizeFilterString(safeGet(waitingState, 'nodeId')),
    metadata: safeClone(safeGet(waitingState, 'metadata', {}), {}) ?? {},
  };
  if (!normalized.type && !normalized.resumeAt && !normalized.correlationKey && !normalized.externalRef && !normalized.nodeId && Object.keys(normalized.metadata).length === 0) {
    return null;
  }
  return normalized;
}

function sanitizeProcessInstance(instance) {
  if (!instance || typeof instance !== 'object') return {};
  return {
    executionId: safeToString(safeGet(instance, 'executionId', ''), ''),
    processId: safeToString(safeGet(instance, 'processId', ''), ''),
    processVersion: safeNumber(safeGet(instance, 'processVersion', 1), 1),
    status: safeToString(safeGet(instance, 'status', PROCESS_INSTANCE_STATUSES.PENDING), PROCESS_INSTANCE_STATUSES.PENDING),
    currentNodeId: safeGet(instance, 'currentNodeId', null) != null ? safeToString(safeGet(instance, 'currentNodeId'), null) : null,
    variablesSnapshot: safeClone(safeGet(instance, 'variablesSnapshot', {}), {}) ?? {},
    waitingState: sanitizeWaitingState(safeGet(instance, 'waitingState', null)),
    startedAt: safeGet(instance, 'startedAt', null),
    updatedAt: safeGet(instance, 'updatedAt', null),
    completedAt: safeGet(instance, 'completedAt', null),
    failedAt: safeGet(instance, 'failedAt', null),
    lastEventSequence: safeNumber(safeGet(instance, 'lastEventSequence', 0), 0),
    metadata: safeClone(safeGet(instance, 'metadata', {}), {}) ?? {},
  };
}

function normalizeProcessInstance(instance) {
  return createProcessInstance(sanitizeProcessInstance(instance));
}

function normalizeError(error) {
  if (error && typeof error === 'object') {
    return {
      message: safeGet(error, 'message') || safeToString(error, 'Unknown error'),
      code: safeGet(error, 'code', null),
    };
  }
  return { message: safeToString(error, 'Unknown error') };
}

function mergeMetadata(currentMetadata, extraMetadata) {
  return {
    ...(safeClone(currentMetadata, {}) || {}),
    ...(safeClone(extraMetadata, {}) || {}),
  };
}

function matchesWaitingFilters(instance, { type, correlationKey, externalRef, processId }) {
  const waitingState = safeGet(instance, 'waitingState', null);
  return safeToString(safeGet(instance, 'status', ''), '') === PROCESS_INSTANCE_STATUSES.WAITING
    && !!waitingState
    && (type == null || safeToString(safeGet(waitingState, 'type', ''), '') === type)
    && (correlationKey == null || safeToString(safeGet(waitingState, 'correlationKey', ''), '') === correlationKey)
    && (externalRef == null || safeToString(safeGet(waitingState, 'externalRef', ''), '') === externalRef)
    && (processId == null || safeToString(safeGet(instance, 'processId', ''), '') === processId);
}

function matchesInstanceFilters(instance, { status, processId, tenantId }) {
  const metadata = safeGet(instance, 'metadata', null);
  return (status == null || safeToString(safeGet(instance, 'status', ''), '') === status)
    && (processId == null || safeToString(safeGet(instance, 'processId', ''), '') === processId)
    && (tenantId == null || safeToString(safeGet(metadata, 'tenantId', ''), '') === tenantId);
}

function dbAvailable() {
  return !!getSequelize();
}

class InMemoryProcessInstanceStore {
  constructor() {
    this._instances = new Map();
  }

  async createInstance(instance) {
    const normalized = normalizeProcessInstance(instance);
    normalized.updatedAt = new Date().toISOString();
    this._instances.set(normalized.executionId, normalized);
    return normalizeProcessInstance(normalized);
  }

  async loadInstance(executionId) {
    const found = this._instances.get(safeToString(executionId || '', ''));
    return found ? normalizeProcessInstance(found) : null;
  }

  async saveInstance(instance) {
    const normalized = normalizeProcessInstance(instance);
    normalized.updatedAt = new Date().toISOString();
    this._instances.set(normalized.executionId, normalized);
    return normalizeProcessInstance(normalized);
  }

  async updateInstance(executionId, partial = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    const safePartial = safeShallowCloneRecord(partial);
    const next = normalizeProcessInstance({
      ...current,
      ...safePartial,
      waitingState: safeHasOwn(safePartial, 'waitingState')
        ? sanitizeWaitingState(safeGet(safePartial, 'waitingState', null))
        : current.waitingState,
      updatedAt: new Date().toISOString(),
    });
    this._instances.set(next.executionId, next);
    return normalizeProcessInstance(next);
  }

  async markWaiting(executionId, waitingState) {
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.WAITING,
      waitingState: sanitizeWaitingState(waitingState),
    });
  }

  async markCompleted(executionId, metadata = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.COMPLETED,
      waitingState: null,
      completedAt: new Date().toISOString(),
      metadata: mergeMetadata(current.metadata, metadata),
      currentNodeId: null,
    });
  }

  async markFailed(executionId, error) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.FAILED,
      waitingState: null,
      failedAt: new Date().toISOString(),
      metadata: {
        ...mergeMetadata(current.metadata, {}),
        error: normalizeError(error),
      },
    });
  }

  async markCancelled(executionId, reason = null, metadata = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.CANCELLED,
      waitingState: null,
      metadata: {
        ...mergeMetadata(current.metadata, metadata),
        cancellation: {
          reason: reason ? safeToString(reason, null) : null,
          cancelledAt: new Date().toISOString(),
        },
      },
    });
  }

  async listWaitingInstances(filters = {}) {
    const type = resolveFilterString(filters, 'type');
    const correlationKey = resolveFilterString(filters, 'correlationKey');
    const externalRef = resolveFilterString(filters, 'externalRef');
    const processId = resolveFilterString(filters, 'processId');

    return Array.from(this._instances.values())
      .filter((instance) => matchesWaitingFilters(instance, { type, correlationKey, externalRef, processId }))
      .map((instance) => normalizeProcessInstance(instance));
  }

  async listInstances(filters = {}) {
    const status = resolveFilterString(filters, 'status');
    const processId = resolveFilterString(filters, 'processId');
    const tenantId = resolveFilterString(filters, 'tenantId');
    return Array.from(this._instances.values())
      .filter((instance) => matchesInstanceFilters(instance, { status, processId, tenantId }))
      .sort((a, b) => safeToString(safeGet(b, 'updatedAt', ''), '').localeCompare(safeToString(safeGet(a, 'updatedAt', ''), '')))
      .slice(0, Math.min(Math.max(safeNumber(safeGet(filters, 'limit', 100), 100), 1), 500))
      .map((instance) => normalizeProcessInstance(instance));
  }
}

class SequelizeProcessInstanceStore {
  constructor() {
    this._fallback = new InMemoryProcessInstanceStore();
  }

  get model() {
    return Execution();
  }

  async createInstance(instance) {
    if (!dbAvailable()) return this._fallback.createInstance(instance);
    const normalized = normalizeProcessInstance(instance);
    const row = await this.model.create({
      execution_id: normalized.executionId,
      status: normalized.status,
      data: safeClone(normalized, normalized),
    });
    const json = row.toJSON ? row.toJSON() : row;
    return normalizeProcessInstance(json.data || normalized);
  }

  async loadInstance(executionId) {
    if (!dbAvailable()) return this._fallback.loadInstance(executionId);
    const row = await this.model.findByPk(safeToString(executionId || '', ''));
    if (!row) return null;
    const json = row.toJSON ? row.toJSON() : row;
    return normalizeProcessInstance(json.data || {});
  }

  async saveInstance(instance) {
    if (!dbAvailable()) return this._fallback.saveInstance(instance);
    const normalized = normalizeProcessInstance({
      ...safeShallowCloneRecord(instance),
      updatedAt: new Date().toISOString(),
    });
    const existing = await this.model.findByPk(normalized.executionId);
    if (!existing) {
      return this.createInstance(normalized);
    }
    existing.status = normalized.status;
    existing.data = safeClone(normalized, normalized);
    await existing.save();
    return normalizeProcessInstance(normalized);
  }

  async updateInstance(executionId, partial = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    const safePartial = safeShallowCloneRecord(partial);
    return this.saveInstance({
      ...current,
      ...safePartial,
      waitingState: safeHasOwn(safePartial, 'waitingState')
        ? sanitizeWaitingState(safeGet(safePartial, 'waitingState', null))
        : current.waitingState,
    });
  }

  async markWaiting(executionId, waitingState) {
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.WAITING,
      waitingState: sanitizeWaitingState(waitingState),
    });
  }

  async markCompleted(executionId, metadata = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.COMPLETED,
      waitingState: null,
      completedAt: new Date().toISOString(),
      metadata: mergeMetadata(current.metadata, metadata),
      currentNodeId: null,
    });
  }

  async markFailed(executionId, error) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.FAILED,
      waitingState: null,
      failedAt: new Date().toISOString(),
      metadata: {
        ...mergeMetadata(current.metadata, {}),
        error: normalizeError(error),
      },
    });
  }

  async markCancelled(executionId, reason = null, metadata = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.CANCELLED,
      waitingState: null,
      metadata: {
        ...mergeMetadata(current.metadata, metadata),
        cancellation: {
          reason: reason ? safeToString(reason, null) : null,
          cancelledAt: new Date().toISOString(),
        },
      },
    });
  }

  async listWaitingInstances(filters = {}) {
    if (!dbAvailable()) return this._fallback.listWaitingInstances(filters);
    const rows = await this.model.findAll({
      where: {
        status: PROCESS_INSTANCE_STATUSES.WAITING,
      },
      order: [['updated_at', 'DESC']],
      limit: 1000,
    });
    const items = rows
      .map((row) => (row.toJSON ? row.toJSON() : row))
      .map((row) => normalizeProcessInstance(row.data || {}));
    const type = resolveFilterString(filters, 'type');
    const correlationKey = resolveFilterString(filters, 'correlationKey');
    const externalRef = resolveFilterString(filters, 'externalRef');
    const processId = resolveFilterString(filters, 'processId');
    return items
      .filter((instance) => matchesWaitingFilters(instance, { type, correlationKey, externalRef, processId }));
  }

  async listInstances(filters = {}) {
    if (!dbAvailable()) return this._fallback.listInstances(filters);
    const rows = await this.model.findAll({
      order: [['updated_at', 'DESC']],
      limit: Math.min(Math.max(safeNumber(safeGet(filters, 'limit', 100), 100), 1), 500),
    });
    const items = rows
      .map((row) => (row.toJSON ? row.toJSON() : row))
      .map((row) => normalizeProcessInstance(row.data || {}));
    const status = resolveFilterString(filters, 'status');
    const processId = resolveFilterString(filters, 'processId');
    const tenantId = resolveFilterString(filters, 'tenantId');
    return items
      .filter((instance) => matchesInstanceFilters(instance, { status, processId, tenantId }));
  }
}

module.exports = {
  InMemoryProcessInstanceStore,
  SequelizeProcessInstanceStore,
};
