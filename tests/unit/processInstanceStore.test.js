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
});
