'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const {
  InMemoryProcessIdempotencyService,
} = require('../../api/core/process-runtime/processIdempotencyService');

describe('InMemoryProcessIdempotencyService', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('runOnce executa uma vez e reaproveita em chamadas seguintes', withTimeout(async () => {
    const service = new InMemoryProcessIdempotencyService();
    const executor = jest.fn(async () => ({ ok: true, nested: { value: 1 } }));

    const first = await service.runOnce({ executionId: 'exec-1', nodeId: 'node-1', sequence: 1 }, executor);
    const second = await service.runOnce({ executionId: 'exec-1', nodeId: 'node-1', sequence: 1 }, executor);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(second.value).toEqual({ ok: true, nested: { value: 1 } });
  }, 5000));

  test('getRecord tolera metadata persistida hostil sem lançar', withTimeout(async () => {
    const { proxy: hostileRecords, revoke } = Proxy.revocable({ 'exec-2:node-2:2': { ok: true } }, {});
    revoke();

    const instanceStore = {
      loadInstance: jest.fn(async () => ({ metadata: { idempotencyRecords: hostileRecords } })),
      updateInstance: jest.fn(async () => null),
    };
    const service = new InMemoryProcessIdempotencyService({ instanceStore });

    const found = await service.getRecord('exec-2:node-2:2', { executionId: 'exec-2' });
    expect(found).toBeNull();
  }, 5000));

  test('saveRecord persiste em instanceStore com fallback quando metadata e hostil', withTimeout(async () => {
    const { proxy: hostileMetadata, revoke } = Proxy.revocable({ idempotencyRecords: { old: true } }, {});
    revoke();

    const instanceStore = {
      loadInstance: jest.fn(async () => ({ metadata: hostileMetadata })),
      updateInstance: jest.fn(async () => null),
    };
    const service = new InMemoryProcessIdempotencyService({ instanceStore });

    const saved = await service.saveRecord('exec-3:node-3:3', { done: true }, { executionId: 'exec-3' });

    expect(saved).toEqual({ done: true });
    expect(instanceStore.updateInstance).toHaveBeenCalledTimes(1);
    expect(instanceStore.updateInstance.mock.calls[0][0]).toBe('exec-3');
    expect(instanceStore.updateInstance.mock.calls[0][1].metadata.idempotencyRecords['exec-3:node-3:3']).toEqual({ done: true });
  }, 5000));

  test('buildKey tolera parametros hostis com fallback seguro', withTimeout(async () => {
    const service = new InMemoryProcessIdempotencyService();

    const { proxy: hostileExecutionId, revoke: revokeExecutionId } = Proxy.revocable({ value: 'exec-4' }, {});
    revokeExecutionId();
    const { proxy: hostileNodeId, revoke: revokeNodeId } = Proxy.revocable({ value: 'node-4' }, {});
    revokeNodeId();
    const { proxy: hostileSequence, revoke: revokeSequence } = Proxy.revocable({ valueOf: () => 4 }, {});
    revokeSequence();

    const key = service.buildKey({
      executionId: hostileExecutionId,
      nodeId: hostileNodeId,
      sequence: hostileSequence,
    });

    expect(key).toBe('::0');
  }, 5000));
});
