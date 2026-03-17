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

function safeFiniteNumber(value, fallbackValue = 0) {
  try {
    const coerced = Number(value);
    return Number.isFinite(coerced) ? coerced : fallbackValue;
  } catch (_) {
    return fallbackValue;
  }
}

function safeNow() {
  try {
    return Date.now();
  } catch (_) {
    return 0;
  }
}

function safeIsoFromMs(ms) {
  try {
    return new Date(ms).toISOString();
  } catch (_) {
    return '1970-01-01T00:00:00.000Z';
  }
}

function safeArrayCopy(value) {
  try {
    return Array.isArray(value) ? value.slice() : [];
  } catch (_) {
    return [];
  }
}

function safeClone(value, fallbackValue = null) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallbackValue;
  }
}

function normalizeCorrelationKey(value) {
  if (value == null) return null;
  const normalized = safeToString(value, '');
  return normalized || null;
}

function parseResumeAtMs(resumeAt) {
  if (resumeAt == null) return NaN;
  try {
    return new Date(resumeAt).getTime();
  } catch (_) {
    return NaN;
  }
}

class ProcessTimerService {
  constructor({ eventBus, instanceStore, resumeService } = {}) {
    this._eventBus = eventBus || null;
    this._instanceStore = instanceStore || null;
    this._resumeService = resumeService || null;
    this._timers = new Map();
    this._readyTimers = new Map();
  }

  async scheduleTimer({ context, node, durationMs, onElapsed, correlationKey = null }) {
    const executionId = safeToString(safeGet(context, 'executionId', ''), '');
    const processId = safeToString(safeGet(context, 'processId', ''), '');
    const nodeId = safeToString(safeGet(node, 'id', ''), '');
    const safeDuration = Math.max(0, safeFiniteNumber(durationMs, 0));
    const now = safeNow();
    const timerId = `${executionId}:${nodeId}:${now}`;
    const readyKey = `${executionId}:${nodeId}`;
    const resumeAt = safeIsoFromMs(now + safeDuration);
    const waitingState = {
      type: 'timer',
      resumeAt,
      correlationKey: normalizeCorrelationKey(correlationKey),
      externalRef: timerId,
      nodeId,
      metadata: { durationMs: safeDuration, timerId },
    };

    if (this._instanceStore) {
      await this._instanceStore.markWaiting(executionId, waitingState);
    }

    const handle = setTimeout(async () => {
      this._timers.delete(timerId);
      const payload = {
        timerId,
        processId,
        executionId,
        nodeId,
        metadata: { durationMs: safeDuration },
      };
      this._readyTimers.set(readyKey, payload);
      if (this._eventBus) {
        try {
          this._eventBus.emit('PROCESS_TIMEOUT', payload);
        } catch (_) {}
      }
      if (typeof onElapsed === 'function') {
        try {
          await onElapsed({
            timerId,
            durationMs: safeDuration,
            nodeId,
            executionId,
            processId,
          });
        } catch (_) {}
      }
      if (this._resumeService) {
        try {
          await this._resumeService.resumeByTimer(executionId);
        } catch (_) {}
      }
    }, safeDuration);

    this._timers.set(timerId, {
      timerId,
      executionId,
      nodeId,
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
    const waitingInstances = safeArrayCopy(await this._instanceStore.listWaitingInstances({ type: 'timer' }));
    const recovered = [];
    for (const instance of waitingInstances) {
      const executionId = safeToString(safeGet(instance, 'executionId', ''), '');
      const processId = safeToString(safeGet(instance, 'processId', ''), '');
      const waitingState = safeGet(instance, 'waitingState', null);
      const resumeAt = safeGet(waitingState, 'resumeAt', null);
      const nodeId = safeToString(safeGet(waitingState, 'nodeId', ''), '');
      if (!waitingState || !resumeAt || !nodeId || !executionId) continue;
      const durationMs = Math.max(parseResumeAtMs(resumeAt) - safeNow(), 0);
      const timerId = normalizeCorrelationKey(safeGet(waitingState, 'externalRef')) || `${executionId}:${nodeId}:recovered`;
      if (this._timers.has(timerId)) continue;
      const handle = setTimeout(async () => {
        this._timers.delete(timerId);
        const payload = {
          timerId,
          processId,
          executionId,
          nodeId,
          metadata: safeClone(safeGet(waitingState, 'metadata', {}), {}) || {},
        };
        this._readyTimers.set(`${executionId}:${nodeId}`, payload);
        if (this._eventBus) {
          try {
            this._eventBus.publishRuntimeEvent({
              eventType: 'PROCESS_TIMEOUT',
              ...payload,
              timestamp: safeIsoFromMs(safeNow()),
              mode: 'broadcast',
            });
          } catch (_) {}
        }
        if (this._resumeService) {
          try {
            await this._resumeService.resumeByTimer(executionId);
          } catch (_) {}
        }
      }, durationMs);
      this._timers.set(timerId, {
        timerId,
        executionId,
        nodeId,
        durationMs,
        handle,
      });
      recovered.push(timerId);
    }
    return recovered;
  }

  async resumeExpiredTimers() {
    if (!this._instanceStore || !this._resumeService) return [];
    const waitingInstances = safeArrayCopy(await this._instanceStore.listWaitingInstances({ type: 'timer' }));
    const resumed = [];
    for (const instance of waitingInstances) {
      const executionId = safeToString(safeGet(instance, 'executionId', ''), '');
      if (!executionId) continue;
      const resumeAt = parseResumeAtMs(safeGet(safeGet(instance, 'waitingState', null), 'resumeAt', null));
      if (!Number.isFinite(resumeAt) || resumeAt > safeNow()) continue;
      // eslint-disable-next-line no-await-in-loop
      await this._resumeService.resumeByTimer(executionId);
      resumed.push(executionId);
    }
    return resumed;
  }

  isReady(executionId, nodeId) {
    return this._readyTimers.has(`${safeToString(executionId || '', '')}:${safeToString(nodeId || '', '')}`);
  }

  consumeReadyTimer(executionId, nodeId) {
    const key = `${safeToString(executionId || '', '')}:${safeToString(nodeId || '', '')}`;
    const payload = this._readyTimers.get(key) || null;
    if (payload) {
      this._readyTimers.delete(key);
    }
    return payload;
  }

  cancelByExecutionId(executionId) {
    const target = safeToString(executionId || '', '');
    for (const [timerId, timer] of this._timers.entries()) {
      if (safeToString(safeGet(timer, 'executionId', ''), '') !== target) continue;
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
