'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessEventBus } = require('../../api/core/process-runtime/processEventBus');

describe('ProcessEventBus', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('emit tolera eventType hostil e faz broadcast em PROCESS_EVENT', withTimeout(async () => {
    const bus = new ProcessEventBus();
    const listener = jest.fn();
    bus.on('PROCESS_EVENT', listener);

    const { proxy: hostileEventType, revoke } = Proxy.revocable({ value: 'NODE_ENTER' }, {});
    revoke();
    const runtimeEvent = await bus.emit(hostileEventType, { executionId: 'exec-bus-1' });

    expect(runtimeEvent.eventType).toBe('PROCESS_EVENT');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].executionId).toBe('exec-bus-1');
  }, 5000));

  test('persistExecutionEvent tolera payload hostil sem quebrar', withTimeout(async () => {
    const bus = new ProcessEventBus();
    const { proxy: hostilePayload, revoke } = Proxy.revocable({ executionId: 'exec-bus-2', payload: { ok: true } }, {});
    revoke();

    const event = await bus.persistExecutionEvent('NODE_ENTER', hostilePayload);

    expect(event.eventType).toBe('NODE_ENTER');
    expect(event.mode).toBe('persisted');
    expect(typeof event.timestamp).toBe('string');
  }, 5000));

  test('persistExecutionEvent com executionRepository ignora executionId hostil e nao persiste', withTimeout(async () => {
    const executionRepository = {
      getNextSequence: jest.fn(async () => 1),
      appendEvent: jest.fn(async (event) => event),
    };
    const bus = new ProcessEventBus({ executionRepository });
    const { proxy: hostileExecutionId, revoke } = Proxy.revocable({ value: 'exec-bus-3' }, {});
    revoke();

    const result = await bus.persistExecutionEvent('NODE_ENTER', {
      executionId: hostileExecutionId,
      payload: { ok: true },
    });

    expect(result.mode).toBe('persisted');
    expect(executionRepository.getNextSequence).not.toHaveBeenCalled();
    expect(executionRepository.appendEvent).not.toHaveBeenCalled();
  }, 5000));

  test('getEvents tolera filtro hostil e retorna snapshot completo', withTimeout(async () => {
    const bus = new ProcessEventBus();
    await bus.emit('PROCESS_STARTED', { executionId: 'exec-bus-4' });
    await bus.emit('PROCESS_COMPLETED', { executionId: 'exec-bus-5' });

    const { proxy: hostileFilter, revoke } = Proxy.revocable({ executionId: 'exec-bus-4' }, {
      get() {
        throw new Error('filter_get_boom');
      },
    });
    revoke();

    const events = bus.getEvents(hostileFilter);
    expect(events).toHaveLength(2);
  }, 5000));
});
