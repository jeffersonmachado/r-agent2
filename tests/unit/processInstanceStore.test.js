'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { InMemoryProcessInstanceStore } = require('../../api/core/process-runtime/processInstanceStore');

describe('InMemoryProcessInstanceStore', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('cria, atualiza e lista instancias em waiting', withTimeout(async () => {
    const store = new InMemoryProcessInstanceStore();
    await store.createInstance({
      executionId: 'exec-store-1',
      processId: 'proc-1',
      processVersion: 1,
      status: 'pending',
      currentNodeId: 'start-1',
      variablesSnapshot: { a: 1 },
      metadata: { tenantId: 't-1' },
    });

    await store.markWaiting('exec-store-1', {
      type: 'message',
      correlationKey: 'corr-1',
      nodeId: 'receive-1',
      metadata: { variable: 'user_input' },
    });

    const loaded = await store.loadInstance('exec-store-1');
    const waiting = await store.listWaitingInstances({ correlationKey: 'corr-1' });

    expect(loaded.status).toBe('waiting');
    expect(loaded.waitingState).toMatchObject({
      type: 'message',
      nodeId: 'receive-1',
    });
    expect(waiting).toHaveLength(1);
  }, 5000));

  test('createInstance tolera snapshots hostis e aplica fallback seguro', withTimeout(async () => {
    const store = new InMemoryProcessInstanceStore();
    const { proxy: hostileVariables, revoke: revokeVariables } = Proxy.revocable({ a: 1 }, {});
    revokeVariables();
    const { proxy: hostileMetadata, revoke: revokeMetadata } = Proxy.revocable({ tenantId: 't-x' }, {});
    revokeMetadata();
    const { proxy: hostileWaitingState, revoke: revokeWaitingState } = Proxy.revocable({ type: 'message', correlationKey: 'corr-x' }, {});
    revokeWaitingState();

    const created = await store.createInstance({
      executionId: 'exec-store-hostile',
      processId: 'proc-hostile',
      processVersion: 1,
      status: 'waiting',
      currentNodeId: 'receive-1',
      variablesSnapshot: hostileVariables,
      metadata: hostileMetadata,
      waitingState: hostileWaitingState,
    });

    expect(created.executionId).toBe('exec-store-hostile');
    expect(created.variablesSnapshot).toEqual({});
    expect(created.metadata).toEqual({});
    expect(created.waitingState).toBeNull();
  }, 5000));

  test('listWaitingInstances tolera filtro hostil sem lançar', withTimeout(async () => {
    const store = new InMemoryProcessInstanceStore();
    await store.createInstance({
      executionId: 'exec-store-filter',
      processId: 'proc-1',
      processVersion: 1,
      status: 'waiting',
      currentNodeId: 'receive-1',
      waitingState: { type: 'message', correlationKey: 'corr-filter', nodeId: 'receive-1' },
    });

    const { proxy: hostileFilter, revoke } = Proxy.revocable({ value: 'corr-filter' }, {});
    revoke();
    const result = await store.listWaitingInstances({ correlationKey: hostileFilter });

    expect(result).toEqual([]);
  }, 5000));

  test('listWaitingInstances ignora instância hostil persistida no mapa', withTimeout(async () => {
    const store = new InMemoryProcessInstanceStore();
    await store.createInstance({
      executionId: 'exec-store-valid',
      processId: 'proc-1',
      processVersion: 1,
      status: 'waiting',
      currentNodeId: 'receive-1',
      waitingState: { type: 'message', correlationKey: 'corr-valid', nodeId: 'receive-1' },
    });

    const { proxy: hostileInstance, revoke } = Proxy.revocable({
      executionId: 'exec-hostile-map',
      status: 'waiting',
      waitingState: { type: 'message', correlationKey: 'corr-valid' },
    }, {});
    revoke();
    store._instances.set('exec-hostile-map', hostileInstance);

    const result = await store.listWaitingInstances({ correlationKey: 'corr-valid' });

    expect(result).toHaveLength(1);
    expect(result[0].executionId).toBe('exec-store-valid');
  }, 5000));
});
