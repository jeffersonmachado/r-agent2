'use strict';

class ProcessTimerService {
  constructor({ eventBus, instanceStore, resumeService } = {}) {
    this._eventBus = eventBus || null;
    this._instanceStore = instanceStore || null;
    this._resumeService = resumeService || null;
    this._timers = new Map();
    this._readyTimers = new Map();
  }

  async scheduleTimer({ context, node, durationMs, onElapsed, correlationKey = null }) {
    const safeDuration = Number.isFinite(Number(durationMs)) ? Math.max(0, Number(durationMs)) : 0;
    const timerId = `${String(context.executionId)}:${String(node.id)}:${Date.now()}`;
    const readyKey = `${String(context.executionId)}:${String(node.id)}`;
    const resumeAt = new Date(Date.now() + safeDuration).toISOString();
    const waitingState = {
      type: 'timer',
      resumeAt,
      correlationKey: correlationKey ? String(correlationKey) : null,
      externalRef: timerId,
      nodeId: String(node.id),
      metadata: { durationMs: safeDuration, timerId },
    };

    if (this._instanceStore) {
      await this._instanceStore.markWaiting(context.executionId, waitingState);
    }

    const handle = setTimeout(async () => {
      this._timers.delete(timerId);
      const payload = {
        timerId,
        processId: context.processId,
        executionId: context.executionId,
        nodeId: node.id,
        metadata: { durationMs: safeDuration },
      };
      this._readyTimers.set(readyKey, payload);
      if (this._eventBus) {
        this._eventBus.emit('PROCESS_TIMEOUT', payload);
      }
      if (typeof onElapsed === 'function') {
        await onElapsed({
          timerId,
          durationMs: safeDuration,
          nodeId: node.id,
          executionId: context.executionId,
          processId: context.processId,
        });
      }
      if (this._resumeService) {
        try {
          await this._resumeService.resumeByTimer(context.executionId);
        } catch (_) {}
      }
    }, safeDuration);

    this._timers.set(timerId, {
      timerId,
      executionId: context.executionId,
      nodeId: node.id,
      durationMs: safeDuration,
      handle,
    });

    return {
      timerId,
      durationMs: safeDuration,
      resumeAt,
      waitingState,
    };
  }

  attachResumeService(resumeService) {
    this._resumeService = resumeService || null;
  }

  async recoverPendingTimers() {
    if (!this._instanceStore) return [];
    const waitingInstances = await this._instanceStore.listWaitingInstances({ type: 'timer' });
    const recovered = [];
    for (const instance of waitingInstances) {
      const waitingState = instance.waitingState || null;
      if (!waitingState || !waitingState.resumeAt || !waitingState.nodeId) continue;
      const durationMs = Math.max(new Date(waitingState.resumeAt).getTime() - Date.now(), 0);
      const timerId = waitingState.externalRef || `${instance.executionId}:${waitingState.nodeId}:recovered`;
      if (this._timers.has(timerId)) continue;
      const handle = setTimeout(async () => {
        this._timers.delete(timerId);
        const payload = {
          timerId,
          processId: instance.processId,
          executionId: instance.executionId,
          nodeId: waitingState.nodeId,
          metadata: waitingState.metadata || {},
        };
        this._readyTimers.set(`${instance.executionId}:${waitingState.nodeId}`, payload);
        if (this._eventBus) {
          this._eventBus.publishRuntimeEvent({
            eventType: 'PROCESS_TIMEOUT',
            ...payload,
            timestamp: new Date().toISOString(),
            mode: 'broadcast',
          });
        }
        if (this._resumeService) {
          try {
            await this._resumeService.resumeByTimer(instance.executionId);
          } catch (_) {}
        }
      }, durationMs);
      this._timers.set(timerId, {
        timerId,
        executionId: instance.executionId,
        nodeId: waitingState.nodeId,
        durationMs,
        handle,
      });
      recovered.push(timerId);
    }
    return recovered;
  }

  async resumeExpiredTimers() {
    if (!this._instanceStore || !this._resumeService) return [];
    const waitingInstances = await this._instanceStore.listWaitingInstances({ type: 'timer' });
    const resumed = [];
    for (const instance of waitingInstances) {
      const resumeAt = instance.waitingState?.resumeAt ? new Date(instance.waitingState.resumeAt).getTime() : NaN;
      if (!Number.isFinite(resumeAt) || resumeAt > Date.now()) continue;
      // eslint-disable-next-line no-await-in-loop
      await this._resumeService.resumeByTimer(instance.executionId);
      resumed.push(instance.executionId);
    }
    return resumed;
  }

  isReady(executionId, nodeId) {
    return this._readyTimers.has(`${String(executionId || '')}:${String(nodeId || '')}`);
  }

  consumeReadyTimer(executionId, nodeId) {
    const key = `${String(executionId || '')}:${String(nodeId || '')}`;
    const payload = this._readyTimers.get(key) || null;
    if (payload) {
      this._readyTimers.delete(key);
    }
    return payload;
  }

  cancelByExecutionId(executionId) {
    const target = String(executionId || '');
    for (const [timerId, timer] of this._timers.entries()) {
      if (String(timer.executionId) !== target) continue;
      clearTimeout(timer.handle);
      this._timers.delete(timerId);
    }
    for (const readyKey of this._readyTimers.keys()) {
      if (readyKey.startsWith(`${target}:`)) {
        this._readyTimers.delete(readyKey);
      }
    }
  }
}

module.exports = {
  ProcessTimerService,
};
