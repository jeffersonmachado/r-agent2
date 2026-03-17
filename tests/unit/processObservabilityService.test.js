'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessEventBus } = require('../../api/core/process-runtime/processEventBus');
const { ProcessObservabilityService } = require('../../api/core/process-runtime/processObservabilityService');

describe('ProcessObservabilityService', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('record tolera evento revogado e gera registro mínimo seguro', withTimeout(async () => {
    const service = new ProcessObservabilityService();
    const { proxy: hostileEvent, revoke } = Proxy.revocable({ eventType: 'NODE_ENTER' }, {});
    revoke();

    const record = service.record(hostileEvent);
    expect(record).toMatchObject({
      eventType: 'PROCESS_EVENT',
      processId: null,
      executionId: null,
      nodeId: null,
      nodeType: null,
      durationMs: null,
      fallback: null,
      error: null,
      metadata: {},
    });
    expect(service.getRecords()).toHaveLength(1);
  }, 5000));

  test('record calcula duration para NODE_EXIT após NODE_ENTER', withTimeout(async () => {
    const service = new ProcessObservabilityService();

    service.record({
      processId: 'proc-1',
      executionId: 'exec-obs-1',
      nodeId: 'node-1',
      nodeType: 'task.service',
      eventType: 'NODE_ENTER',
      timestamp: '2026-03-17T12:00:00.000Z',
      payload: {},
      metadata: {},
    });
    const record = service.record({
      processId: 'proc-1',
      executionId: 'exec-obs-1',
      nodeId: 'node-1',
      nodeType: 'task.service',
      eventType: 'NODE_EXIT',
      timestamp: '2026-03-17T12:00:01.000Z',
      payload: {},
      metadata: {},
    });

    expect(record.eventType).toBe('NODE_EXIT');
    expect(typeof record.durationMs).toBe('number');
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
  }, 5000));

  test('record tolera payload e metadata hostis com fallback seguro', withTimeout(async () => {
    const service = new ProcessObservabilityService();
    const { proxy: hostilePayload, revoke: revokePayload } = Proxy.revocable({ mode: 'fallback' }, {});
    revokePayload();
    const { proxy: hostileMetadata, revoke: revokeMetadata } = Proxy.revocable({ source: 'x' }, {});
    revokeMetadata();

    const record = service.record({
      processId: 'proc-1',
      executionId: 'exec-obs-2',
      nodeId: 'node-2',
      nodeType: 'fallback',
      eventType: 'NODE_FALLBACK',
      payload: hostilePayload,
      metadata: hostileMetadata,
    });

    expect(record.eventType).toBe('NODE_FALLBACK');
    expect(record.fallback).toBeNull();
    expect(record.error).toBeNull();
    expect(record.metadata).toEqual({});
  }, 5000));

  test('integra com eventBus e getRecords tolera filtro hostil', withTimeout(async () => {
    const bus = new ProcessEventBus();
    const service = new ProcessObservabilityService({ eventBus: bus });

    await bus.emit('PROCESS_STARTED', { executionId: 'exec-obs-3', processId: 'proc-1' });
    await bus.emit('PROCESS_COMPLETED', { executionId: 'exec-obs-4', processId: 'proc-1' });

    const { proxy: hostileFilter, revoke } = Proxy.revocable({ executionId: 'exec-obs-3' }, {
      get() {
        throw new Error('filter_get_boom');
      },
    });
    revoke();

    const all = service.getRecords(hostileFilter);
    expect(all).toHaveLength(2);
  }, 5000));
});
