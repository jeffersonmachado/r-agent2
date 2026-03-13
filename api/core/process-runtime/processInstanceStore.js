'use strict';

const { createProcessInstance, createWaitingState, PROCESS_INSTANCE_STATUSES } = require('./processInstanceTypes');
const { getSequelize } = require('../../db/sequelize');
const { Execution } = require('../../db/models');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function dbAvailable() {
  return !!getSequelize();
}

class InMemoryProcessInstanceStore {
  constructor() {
    this._instances = new Map();
  }

  async createInstance(instance) {
    const normalized = createProcessInstance(instance);
    normalized.updatedAt = new Date().toISOString();
    this._instances.set(normalized.executionId, normalized);
    return createProcessInstance(normalized);
  }

  async loadInstance(executionId) {
    const found = this._instances.get(String(executionId || ''));
    return found ? createProcessInstance(found) : null;
  }

  async saveInstance(instance) {
    const normalized = createProcessInstance(instance);
    normalized.updatedAt = new Date().toISOString();
    this._instances.set(normalized.executionId, normalized);
    return createProcessInstance(normalized);
  }

  async updateInstance(executionId, partial = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    const next = createProcessInstance({
      ...current,
      ...partial,
      waitingState: Object.prototype.hasOwnProperty.call(partial, 'waitingState')
        ? createWaitingState(partial.waitingState)
        : current.waitingState,
      updatedAt: new Date().toISOString(),
    });
    this._instances.set(next.executionId, next);
    return createProcessInstance(next);
  }

  async markWaiting(executionId, waitingState) {
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.WAITING,
      waitingState: createWaitingState(waitingState),
    });
  }

  async markCompleted(executionId, metadata = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.COMPLETED,
      waitingState: null,
      completedAt: new Date().toISOString(),
      metadata: {
        ...(current.metadata || {}),
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
      },
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
        ...(current.metadata || {}),
        error: error && typeof error === 'object'
          ? { message: error.message || String(error), code: error.code || null }
          : { message: String(error) },
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
        ...(current.metadata || {}),
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        cancellation: {
          reason: reason ? String(reason) : null,
          cancelledAt: new Date().toISOString(),
        },
      },
    });
  }

  async listWaitingInstances(filters = {}) {
    const type = filters.type ? String(filters.type) : null;
    const correlationKey = filters.correlationKey ? String(filters.correlationKey) : null;
    const externalRef = filters.externalRef ? String(filters.externalRef) : null;
    const processId = filters.processId ? String(filters.processId) : null;

    return Array.from(this._instances.values())
      .filter((instance) => instance.status === PROCESS_INSTANCE_STATUSES.WAITING && instance.waitingState)
      .filter((instance) => !type || String(instance.waitingState.type) === type)
      .filter((instance) => !correlationKey || String(instance.waitingState.correlationKey || '') === correlationKey)
      .filter((instance) => !externalRef || String(instance.waitingState.externalRef || '') === externalRef)
      .filter((instance) => !processId || String(instance.processId || '') === processId)
      .map((instance) => createProcessInstance(instance));
  }

  async listInstances(filters = {}) {
    const status = filters.status ? String(filters.status) : null;
    const processId = filters.processId ? String(filters.processId) : null;
    const tenantId = filters.tenantId ? String(filters.tenantId) : null;
    return Array.from(this._instances.values())
      .filter((instance) => !status || String(instance.status) === status)
      .filter((instance) => !processId || String(instance.processId || '') === processId)
      .filter((instance) => !tenantId || String(instance.metadata?.tenantId || '') === tenantId)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      .slice(0, Math.min(Math.max(Number(filters.limit) || 100, 1), 500))
      .map((instance) => createProcessInstance(instance));
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
    const normalized = createProcessInstance(instance);
    const row = await this.model.create({
      execution_id: normalized.executionId,
      status: normalized.status,
      data: clone(normalized),
    });
    const json = row.toJSON ? row.toJSON() : row;
    return createProcessInstance(json.data || normalized);
  }

  async loadInstance(executionId) {
    if (!dbAvailable()) return this._fallback.loadInstance(executionId);
    const row = await this.model.findByPk(String(executionId || ''));
    if (!row) return null;
    const json = row.toJSON ? row.toJSON() : row;
    return createProcessInstance(json.data || {});
  }

  async saveInstance(instance) {
    if (!dbAvailable()) return this._fallback.saveInstance(instance);
    const normalized = createProcessInstance({
      ...instance,
      updatedAt: new Date().toISOString(),
    });
    const existing = await this.model.findByPk(normalized.executionId);
    if (!existing) {
      return this.createInstance(normalized);
    }
    existing.status = normalized.status;
    existing.data = clone(normalized);
    await existing.save();
    return createProcessInstance(normalized);
  }

  async updateInstance(executionId, partial = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    return this.saveInstance({
      ...current,
      ...partial,
      waitingState: Object.prototype.hasOwnProperty.call(partial, 'waitingState')
        ? createWaitingState(partial.waitingState)
        : current.waitingState,
    });
  }

  async markWaiting(executionId, waitingState) {
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.WAITING,
      waitingState: createWaitingState(waitingState),
    });
  }

  async markCompleted(executionId, metadata = {}) {
    const current = await this.loadInstance(executionId);
    if (!current) return null;
    return this.updateInstance(executionId, {
      status: PROCESS_INSTANCE_STATUSES.COMPLETED,
      waitingState: null,
      completedAt: new Date().toISOString(),
      metadata: {
        ...(current.metadata || {}),
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
      },
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
        ...(current.metadata || {}),
        error: error && typeof error === 'object'
          ? { message: error.message || String(error), code: error.code || null }
          : { message: String(error) },
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
        ...(current.metadata || {}),
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        cancellation: {
          reason: reason ? String(reason) : null,
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
      .map((row) => createProcessInstance(row.data || {}));
    const type = filters.type ? String(filters.type) : null;
    const correlationKey = filters.correlationKey ? String(filters.correlationKey) : null;
    const externalRef = filters.externalRef ? String(filters.externalRef) : null;
    const processId = filters.processId ? String(filters.processId) : null;
    return items
      .filter((instance) => instance.status === PROCESS_INSTANCE_STATUSES.WAITING && instance.waitingState)
      .filter((instance) => !type || String(instance.waitingState.type) === type)
      .filter((instance) => !correlationKey || String(instance.waitingState.correlationKey || '') === correlationKey)
      .filter((instance) => !externalRef || String(instance.waitingState.externalRef || '') === externalRef)
      .filter((instance) => !processId || String(instance.processId || '') === processId);
  }

  async listInstances(filters = {}) {
    if (!dbAvailable()) return this._fallback.listInstances(filters);
    const rows = await this.model.findAll({
      order: [['updated_at', 'DESC']],
      limit: Math.min(Math.max(Number(filters.limit) || 100, 1), 500),
    });
    const items = rows
      .map((row) => (row.toJSON ? row.toJSON() : row))
      .map((row) => createProcessInstance(row.data || {}));
    const status = filters.status ? String(filters.status) : null;
    const processId = filters.processId ? String(filters.processId) : null;
    const tenantId = filters.tenantId ? String(filters.tenantId) : null;
    return items
      .filter((instance) => !status || String(instance.status) === status)
      .filter((instance) => !processId || String(instance.processId || '') === processId)
      .filter((instance) => !tenantId || String(instance.metadata?.tenantId || '') === tenantId);
  }
}

module.exports = {
  InMemoryProcessInstanceStore,
  SequelizeProcessInstanceStore,
};
