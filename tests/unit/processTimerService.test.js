'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessTimerService } = require('../../api/core/process-runtime/processTimerService');

describe('ProcessTimerService', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('scheduleTimer tolera context/node hostis e dispara callbacks com fallback seguro', withTimeout(async () => {
    const eventBus = {
      emit: jest.fn(),
      publishRuntimeEvent: jest.fn(),
    };
    const instanceStore = {
      markWaiting: jest.fn(async () => {}),
      listWaitingInstances: jest.fn(async () => []),
    };
    const resumeService = {
      resumeByTimer: jest.fn(async () => {}),
    };
    const onElapsed = jest.fn(async () => {});
    const service = new ProcessTimerService({ eventBus, instanceStore, resumeService });

    const { proxy: hostileContext, revoke: revokeContext } = Proxy.revocable({ executionId: 'exec-1', processId: 'proc-1' }, {});
    revokeContext();
    const { proxy: hostileNode, revoke: revokeNode } = Proxy.revocable({ id: 'timer-1' }, {});
    revokeNode();
    const { proxy: hostileCorrelationKey, revoke: revokeCorrelationKey } = Proxy.revocable({ value: 'corr-1' }, {});
    revokeCorrelationKey();

    const timer = await service.scheduleTimer({
      context: hostileContext,
      node: hostileNode,
      durationMs: 0,
      onElapsed,
      correlationKey: hostileCorrelationKey,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(timer.durationMs).toBe(0);
    expect(typeof timer.timerId).toBe('string');
    expect(instanceStore.markWaiting).toHaveBeenCalledWith('', expect.objectContaining({ type: 'timer' }));
    expect(eventBus.emit).toHaveBeenCalledWith('PROCESS_TIMEOUT', expect.any(Object));
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(resumeService.resumeByTimer).toHaveBeenCalledWith('');
  }, 5000));

  test('recoverPendingTimers ignora instâncias hostis e recupera timers válidos', withTimeout(async () => {
    const eventBus = {
      emit: jest.fn(),
      publishRuntimeEvent: jest.fn(),
    };
    const { proxy: hostileInstance, revoke } = Proxy.revocable({ executionId: 'bad' }, {});
    revoke();
    const instanceStore = {
      markWaiting: jest.fn(async () => {}),
      listWaitingInstances: jest.fn(async () => [
        hostileInstance,
        {
          executionId: 'exec-recover-1',
          processId: 'proc-1',
          waitingState: {
            type: 'timer',
            nodeId: 'node-1',
            resumeAt: new Date(Date.now() + 10).toISOString(),
            externalRef: 'timer-recover-1',
            metadata: { durationMs: 10 },
          },
        },
      ]),
    };
    const resumeService = {
      resumeByTimer: jest.fn(async () => {}),
    };
    const service = new ProcessTimerService({ eventBus, instanceStore, resumeService });

    const recovered = await service.recoverPendingTimers();
    expect(recovered).toEqual(['timer-recover-1']);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(eventBus.publishRuntimeEvent).toHaveBeenCalled();
    expect(resumeService.resumeByTimer).toHaveBeenCalledWith('exec-recover-1');
    expect(service.isReady('exec-recover-1', 'node-1')).toBe(true);
    const ready = service.consumeReadyTimer('exec-recover-1', 'node-1');
    expect(ready).toMatchObject({ timerId: 'timer-recover-1', executionId: 'exec-recover-1', nodeId: 'node-1' });
  }, 5000));

  test('resumeExpiredTimers ignora waitingState hostil e retoma apenas expirados', withTimeout(async () => {
    const { proxy: hostileWaitingState, revoke } = Proxy.revocable({ resumeAt: new Date(Date.now() - 1000).toISOString() }, {});
    revoke();

    const instanceStore = {
      markWaiting: jest.fn(async () => {}),
      listWaitingInstances: jest.fn(async () => [
        {
          executionId: 'exec-expired',
          waitingState: { type: 'timer', resumeAt: new Date(Date.now() - 1000).toISOString(), nodeId: 'node-1' },
        },
        {
          executionId: 'exec-future',
          waitingState: { type: 'timer', resumeAt: new Date(Date.now() + 5000).toISOString(), nodeId: 'node-2' },
        },
        {
          executionId: 'exec-hostile',
          waitingState: hostileWaitingState,
        },
      ]),
    };
    const resumeService = {
      resumeByTimer: jest.fn(async () => {}),
    };
    const service = new ProcessTimerService({ instanceStore, resumeService });

    const resumed = await service.resumeExpiredTimers();

    expect(resumed).toEqual(['exec-expired']);
    expect(resumeService.resumeByTimer).toHaveBeenCalledTimes(1);
    expect(resumeService.resumeByTimer).toHaveBeenCalledWith('exec-expired');
  }, 5000));

  test('cancelByExecutionId limpa timers pendentes e ready timers', withTimeout(async () => {
    const instanceStore = {
      markWaiting: jest.fn(async () => {}),
      listWaitingInstances: jest.fn(async () => []),
    };
    const service = new ProcessTimerService({ instanceStore });

    await service.scheduleTimer({
      context: { executionId: 'exec-cancel', processId: 'proc-1' },
      node: { id: 'node-1' },
      durationMs: 10,
    });

    service._readyTimers.set('exec-cancel:node-1', { timerId: 'manual' });
    expect(service.isReady('exec-cancel', 'node-1')).toBe(true);

    service.cancelByExecutionId('exec-cancel');

    expect(service.isReady('exec-cancel', 'node-1')).toBe(false);
  }, 5000));
});
