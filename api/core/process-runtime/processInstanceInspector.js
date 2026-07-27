'use strict';

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

function safeShallowCloneRecord(value) {
  if (!value || typeof value !== 'object') return {};
  try {
    return { ...value };
  } catch (_) {
    return {};
  }
}

function safeArrayCopy(value) {
  try {
    return Array.isArray(value) ? value.slice() : [];
  } catch (_) {
    return [];
  }
}

async function safeAsyncCall(fn, args, fallbackValue, thisArg = null) {
  if (typeof fn !== 'function') return fallbackValue;
  try {
    // Métodos de classe (SequelizeProcessInstanceStore, repositórios) dependem
    // de `this`; invocar desvinculado lança TypeError que seria engolido pelo
    // catch, retornando fallback silenciosamente.
    return await fn.apply(thisArg, args);
  } catch (_) {
    return fallbackValue;
  }
}

class ProcessInstanceInspector {
  constructor({ instanceStore, executionRepository, replayService, compiledProcessResolver } = {}) {
    this.instanceStore = instanceStore;
    this.executionRepository = executionRepository;
    this.replayService = replayService;
    this.compiledProcessResolver = compiledProcessResolver || (async () => null);
  }

  async getInstanceState(executionId) {
    const safeExecutionId = safeToString(executionId || '', '');
    if (!safeExecutionId) return null;
    return safeAsyncCall(
      this.instanceStore && this.instanceStore.loadInstance,
      [safeExecutionId],
      null,
      this.instanceStore,
    );
  }

  async listInstances(filters = {}) {
    const safeFilters = safeShallowCloneRecord(filters);
    const items = await safeAsyncCall(
      this.instanceStore && this.instanceStore.listInstances,
      [safeFilters],
      [],
      this.instanceStore,
    );
    return safeArrayCopy(items);
  }

  async getExecutionHistory(executionId) {
    const safeExecutionId = safeToString(executionId || '', '');
    if (!safeExecutionId) return [];
    const history = await safeAsyncCall(
      this.executionRepository && this.executionRepository.listEventsByExecution,
      [safeExecutionId],
      [],
      this.executionRepository,
    );
    return safeArrayCopy(history);
  }

  async getCurrentWaitingState(executionId) {
    const instance = await this.getInstanceState(executionId);
    return safeGet(instance, 'waitingState', null) || null;
  }

  async explainWhyStopped(executionId) {
    const instance = await this.getInstanceState(executionId);
    if (!instance) return null;
    const status = safeToString(safeGet(instance, 'status', ''), '');
    if (status === 'waiting') {
      const safeExecutionId = safeToString(executionId || '', '');
      const lastEvent = await safeAsyncCall(
        this.executionRepository && this.executionRepository.getLastEvent,
        [safeExecutionId],
        null,
        this.executionRepository,
      );
      return {
        reason: 'waiting',
        waitingState: safeGet(instance, 'waitingState', null),
        lastEventType: safeGet(lastEvent, 'eventType', null) || null,
      };
    }
    if (status === 'failed') {
      const metadata = safeGet(instance, 'metadata', null);
      return { reason: 'failed', error: safeGet(metadata, 'error', null) || null };
    }
    if (status === 'completed') return { reason: 'completed' };
    if (status === 'cancelled') return { reason: 'cancelled' };
    return { reason: status };
  }

  async getExecutionPath(executionId) {
    const events = await this.getExecutionHistory(executionId);
    const path = await safeAsyncCall(
      this.replayService && this.replayService.getExecutionPath,
      [events],
      [],
      this.replayService,
    );
    return safeArrayCopy(path);
  }
}

module.exports = {
  ProcessInstanceInspector,
};
