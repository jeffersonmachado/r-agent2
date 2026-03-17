'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const {
  PROCESS_INSTANCE_STATUSES,
  createProcessInstance,
  createWaitingState,
} = require('../../api/core/process-runtime/processInstanceTypes');

describe('process instance types', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('createWaitingState returns null for revoked proxy', withTimeout(async () => {
    const { proxy: hostileWaitingState, revoke } = Proxy.revocable({
      type: 'message',
      correlationKey: 'corr-1',
    }, {});
    revoke();

    const waitingState = createWaitingState(hostileWaitingState);
    expect(waitingState).toBeNull();
  }, 5000));

  test('createWaitingState normalizes valid payload and preserves metadata', withTimeout(async () => {
    const waitingState = createWaitingState({
      type: 'message',
      correlationKey: 'corr-2',
      nodeId: 'receive-1',
      metadata: { variable: 'answer' },
    });

    expect(waitingState).toMatchObject({
      type: 'message',
      correlationKey: 'corr-2',
      nodeId: 'receive-1',
      metadata: { variable: 'answer' },
    });
  }, 5000));

  test('createProcessInstance applies safe defaults for hostile input', withTimeout(async () => {
    const { proxy: hostileExecutionId, revoke: revokeExecutionId } = Proxy.revocable({}, {});
    revokeExecutionId();
    const { proxy: hostileVariables, revoke: revokeVariables } = Proxy.revocable({ a: 1 }, {});
    revokeVariables();
    const { proxy: hostileMetadata, revoke: revokeMetadata } = Proxy.revocable({ tenantId: 'tenant-1' }, {});
    revokeMetadata();
    const { proxy: hostileWaitingState, revoke: revokeWaitingState } = Proxy.revocable({ type: 'message' }, {});
    revokeWaitingState();

    const instance = createProcessInstance({
      executionId: hostileExecutionId,
      processId: 'proc-1',
      processVersion: hostileExecutionId,
      status: hostileExecutionId,
      variablesSnapshot: hostileVariables,
      waitingState: hostileWaitingState,
      metadata: hostileMetadata,
      lastEventSequence: hostileExecutionId,
    });

    expect(instance.executionId).toBe('');
    expect(instance.processId).toBe('proc-1');
    expect(instance.processVersion).toBe(1);
    expect(instance.status).toBe(PROCESS_INSTANCE_STATUSES.PENDING);
    expect(instance.variablesSnapshot).toEqual({});
    expect(instance.waitingState).toBeNull();
    expect(instance.metadata).toEqual({});
    expect(instance.lastEventSequence).toBe(0);
  }, 5000));

  test('createProcessInstance keeps nominal values in normal path', withTimeout(async () => {
    const instance = createProcessInstance({
      executionId: 'exec-1',
      processId: 'proc-2',
      processVersion: 3,
      status: PROCESS_INSTANCE_STATUSES.WAITING,
      currentNodeId: 'node-1',
      variablesSnapshot: { x: 1 },
      waitingState: { type: 'message', correlationKey: 'corr-x' },
      metadata: { tenantId: 'tenant-2' },
      lastEventSequence: 5,
    });

    expect(instance.executionId).toBe('exec-1');
    expect(instance.processId).toBe('proc-2');
    expect(instance.processVersion).toBe(3);
    expect(instance.status).toBe(PROCESS_INSTANCE_STATUSES.WAITING);
    expect(instance.currentNodeId).toBe('node-1');
    expect(instance.variablesSnapshot).toEqual({ x: 1 });
    expect(instance.waitingState).toMatchObject({ type: 'message', correlationKey: 'corr-x' });
    expect(instance.metadata).toEqual({ tenantId: 'tenant-2' });
    expect(instance.lastEventSequence).toBe(5);
  }, 5000));
});
