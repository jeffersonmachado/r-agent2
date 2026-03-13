'use strict';

class ProcessInstanceInspector {
  constructor({ instanceStore, executionRepository, replayService, compiledProcessResolver } = {}) {
    this.instanceStore = instanceStore;
    this.executionRepository = executionRepository;
    this.replayService = replayService;
    this.compiledProcessResolver = compiledProcessResolver || (async () => null);
  }

  async getInstanceState(executionId) {
    return this.instanceStore.loadInstance(executionId);
  }

  async listInstances(filters = {}) {
    if (typeof this.instanceStore.listInstances === 'function') {
      return this.instanceStore.listInstances(filters);
    }
    return [];
  }

  async getExecutionHistory(executionId) {
    return this.executionRepository.listEventsByExecution(executionId);
  }

  async getCurrentWaitingState(executionId) {
    const instance = await this.getInstanceState(executionId);
    return instance?.waitingState || null;
  }

  async explainWhyStopped(executionId) {
    const instance = await this.getInstanceState(executionId);
    if (!instance) return null;
    if (instance.status === 'waiting') {
      const lastEvent = await this.executionRepository.getLastEvent(executionId);
      return {
        reason: 'waiting',
        waitingState: instance.waitingState,
        lastEventType: lastEvent?.eventType || null,
      };
    }
    if (instance.status === 'failed') return { reason: 'failed', error: instance.metadata?.error || null };
    if (instance.status === 'completed') return { reason: 'completed' };
    if (instance.status === 'cancelled') return { reason: 'cancelled' };
    return { reason: instance.status };
  }

  async getExecutionPath(executionId) {
    const events = await this.executionRepository.listEventsByExecution(executionId);
    return this.replayService.getExecutionPath(events);
  }
}

module.exports = {
  ProcessInstanceInspector,
};
