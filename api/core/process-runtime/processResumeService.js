'use strict';

const { PROCESS_INSTANCE_STATUSES, PROCESS_WAITING_TYPES } = require('./processInstanceTypes');

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
    if (instance.status !== PROCESS_INSTANCE_STATUSES.WAITING || !instance.waitingState) {
      throw new Error(`Execution ${executionId} is not waiting`);
    }
    return instance;
  }

  validateWaitingType(instance, allowedTypes = []) {
    if (!Array.isArray(allowedTypes) || allowedTypes.length === 0) return instance;
    const currentType = String(instance.waitingState?.type || '');
    if (!allowedTypes.includes(currentType)) {
      throw new Error(`Execution ${instance.executionId} is waiting for ${currentType}, not ${allowedTypes.join(',')}`);
    }
    return instance;
  }

  async resumeByExecutionId(executionId, payload = {}) {
    await this.loadWaitingInstance(executionId);
    return this.runtimeService.resumeProcess(executionId, payload);
  }

  async resumeByTimer(executionId) {
    const instance = await this.loadWaitingInstance(executionId);
    this.validateWaitingType(instance, [PROCESS_WAITING_TYPES.TIMER]);
    return this.resumeByExecutionId(executionId, { resumeType: 'timer', timerFired: true });
  }

  async resumeByCorrelationKey(correlationKey, payload = {}) {
    const instances = await this.instanceStore.listWaitingInstances({ correlationKey });
    if (instances.length === 0) {
      throw new Error(`Waiting instance not found for correlationKey: ${correlationKey}`);
    }
    if (instances.length > 1) {
      throw new Error(`Multiple waiting instances found for correlationKey: ${correlationKey}`);
    }
    return this.resumeByExecutionId(instances[0].executionId, payload);
  }

  async resumeHumanTask(executionId, payload = {}) {
    const instance = await this.loadWaitingInstance(executionId);
    this.validateWaitingType(instance, [PROCESS_WAITING_TYPES.HUMAN]);
    return this.resumeByExecutionId(executionId, { ...payload, resumeType: 'human' });
  }

  async resumeExternalEvent(correlationKey, payload = {}) {
    const instances = await this.instanceStore.listWaitingInstances({ correlationKey });
    if (instances.length === 0) {
      throw new Error(`Waiting instance not found for correlationKey: ${correlationKey}`);
    }
    if (instances.length > 1) {
      throw new Error(`Multiple waiting instances found for correlationKey: ${correlationKey}`);
    }
    this.validateWaitingType(instances[0], [PROCESS_WAITING_TYPES.EXTERNAL_EVENT, PROCESS_WAITING_TYPES.MESSAGE, PROCESS_WAITING_TYPES.SUBPROCESS]);
    return this.resumeByExecutionId(instances[0].executionId, { ...payload, resumeType: 'external_event' });
  }
}

module.exports = {
  ProcessResumeService,
};
