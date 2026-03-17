'use strict';

const { PROCESS_INSTANCE_STATUSES, PROCESS_WAITING_TYPES } = require('./processInstanceTypes');

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

function normalizeCorrelationKey(correlationKey) {
  const normalized = safeToString(correlationKey, '');
  return normalized || '';
}

class ProcessResumeService {
  constructor({ runtimeService, instanceStore } = {}) {
    this.runtimeService = runtimeService || null;
    this.instanceStore = instanceStore || null;
  }

  async loadWaitingInstance(executionId) {
    const instance = await this.instanceStore.loadInstance(executionId);
    if (!instance) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    const status = safeToString(safeGet(instance, 'status', ''), '');
    const waitingState = safeGet(instance, 'waitingState', null);
    if (status !== PROCESS_INSTANCE_STATUSES.WAITING || !waitingState) {
      throw new Error(`Execution ${executionId} is not waiting`);
    }
    return instance;
  }

  validateWaitingType(instance, allowedTypes = []) {
    if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) return instance;
    const currentType = safeToString(safeGet(safeGet(instance, 'waitingState', null), 'type', ''), '');
    if (!allowedTypes.includes(currentType)) {
      throw new Error(`Execution ${safeToString(safeGet(instance, 'executionId', ''), '')} is waiting for ${currentType}, not ${allowedTypes.join(',')}`);
    }
    return instance;
  }

  async resumeByExecutionId(executionId, payload = {}) {
    await this.loadWaitingInstance(executionId);
    return this.runtimeService.resumeProcess(executionId, safeShallowCloneRecord(payload));
  }

  async resumeByTimer(executionId) {
    const instance = await this.loadWaitingInstance(executionId);
    this.validateWaitingType(instance, [PROCESS_WAITING_TYPES.TIMER]);
    return this.resumeByExecutionId(executionId, { resumeType: 'timer', timerFired: true });
  }

  async resumeByCorrelationKey(correlationKey, payload = {}) {
    const normalizedCorrelationKey = normalizeCorrelationKey(correlationKey);
    const instances = safeArrayCopy(await this.instanceStore.listWaitingInstances({ correlationKey: normalizedCorrelationKey }));
    if (instances.length === 0) {
      throw new Error(`Waiting instance not found for correlationKey: ${normalizedCorrelationKey}`);
    }
    if (instances.length > 1) {
      throw new Error(`Multiple waiting instances found for correlationKey: ${normalizedCorrelationKey}`);
    }
    return this.resumeByExecutionId(safeGet(instances[0], 'executionId', ''), payload);
  }

  async resumeHumanTask(executionId, payload = {}) {
    const instance = await this.loadWaitingInstance(executionId);
    this.validateWaitingType(instance, [PROCESS_WAITING_TYPES.HUMAN]);
    return this.resumeByExecutionId(executionId, { ...safeShallowCloneRecord(payload), resumeType: 'human' });
  }

  async resumeExternalEvent(correlationKey, payload = {}) {
    const normalizedCorrelationKey = normalizeCorrelationKey(correlationKey);
    const instances = safeArrayCopy(await this.instanceStore.listWaitingInstances({ correlationKey: normalizedCorrelationKey }));
    if (instances.length === 0) {
      throw new Error(`Waiting instance not found for correlationKey: ${normalizedCorrelationKey}`);
    }
    if (instances.length > 1) {
      throw new Error(`Multiple waiting instances found for correlationKey: ${normalizedCorrelationKey}`);
    }
    this.validateWaitingType(instances[0], [PROCESS_WAITING_TYPES.EXTERNAL_EVENT, PROCESS_WAITING_TYPES.MESSAGE, PROCESS_WAITING_TYPES.SUBPROCESS]);
    return this.resumeByExecutionId(safeGet(instances[0], 'executionId', ''), { ...safeShallowCloneRecord(payload), resumeType: 'external_event' });
  }
}

module.exports = {
  ProcessResumeService,
};
