'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessExecutionContext } = require('../../api/core/process-runtime/processExecutionContext');

describe('ProcessExecutionContext', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('mantem variaveis, historico e navegacao do processo', withTimeout(async () => {
    const context = new ProcessExecutionContext({
      processId: 'proc-1',
      executionId: 'exec-1',
      currentNodeId: 'start-1',
      variables: { customerId: 'c-1' },
      metadata: { tenantId: 'tenant-1' },
    });

    expect(context.getVariable('customerId')).toBe('c-1');
    expect(context.getVariable('missing', 'fallback')).toBe('fallback');

    context.setVariable('status', 'open');
    context.pushHistory({ role: 'system', type: 'start' });
    context.moveToNode('task-1');

    const compiledProcess = {
      executionGraph: {
        nodesById: {
          'task-1': { id: 'task-1', type: 'task.service' },
        },
      },
    };

    expect(context.getVariable('status')).toBe('open');
    expect(context.history).toHaveLength(1);
    expect(context.getCurrentNode(compiledProcess)).toEqual({ id: 'task-1', type: 'task.service' });
    expect(context.toJSON()).toMatchObject({
      processId: 'proc-1',
      executionId: 'exec-1',
      currentNodeId: 'task-1',
      variables: {
        customerId: 'c-1',
        status: 'open',
      },
      metadata: {
        tenantId: 'tenant-1',
      },
    });
  }, 5000));

  test('construtor com variables/metadata hostis aplica fallback seguro', withTimeout(async () => {
    const { proxy: hostileVars, revoke: revokeVars } = Proxy.revocable({ x: 1 }, {});
    revokeVars();
    const { proxy: hostileMeta, revoke: revokeMeta } = Proxy.revocable({ tenantId: 't-1' }, {});
    revokeMeta();
    const { proxy: hostileRecovery, revoke: revokeRecovery } = Proxy.revocable({ from: 'event-log' }, {});
    revokeRecovery();

    const ctx = new ProcessExecutionContext({
      processId: 'p-1',
      executionId: 'e-1',
      variables: hostileVars,
      metadata: hostileMeta,
      recovery: hostileRecovery,
    });

    expect(ctx.variables).toEqual({});
    expect(ctx.metadata).toEqual({});
    expect(ctx.recovery).toEqual({});
    expect(ctx.processId).toBe('p-1');
  }, 5000));

  test('construtor com history hostil aplica fallback para array vazio', withTimeout(async () => {
    const { proxy: hostileHistory, revoke } = Proxy.revocable([{ role: 'user' }], {});
    revoke();

    const ctx = new ProcessExecutionContext({
      processId: 'p-2',
      executionId: 'e-2',
      history: hostileHistory,
    });

    expect(Array.isArray(ctx.history)).toBe(true);
    expect(ctx.history).toEqual([]);
  }, 5000));

  test('pushHistory com entry hostil nao quebra e registra fallback', withTimeout(async () => {
    const ctx = new ProcessExecutionContext({ processId: 'p-3', executionId: 'e-3' });
    const { proxy: hostileEntry, revoke } = Proxy.revocable({ role: 'user', text: 'hi' }, {});
    revoke();

    ctx.pushHistory(hostileEntry);

    expect(ctx.history).toHaveLength(1);
    expect(typeof ctx.history[0].timestamp).toBe('string');
  }, 5000));

  test('setWaitingState com proxy revogado define null e nao muda status', withTimeout(async () => {
    const ctx = new ProcessExecutionContext({
      processId: 'p-4',
      executionId: 'e-4',
      status: 'running',
    });
    const { proxy: hostileWS, revoke } = Proxy.revocable({ type: 'message' }, {});
    revoke();

    const result = ctx.setWaitingState(hostileWS);

    expect(result).toBeNull();
    expect(ctx.waitingState).toBeNull();
    expect(ctx.status).toBe('running');
  }, 5000));

  test('getCurrentNode com executionGraph hostil retorna null', withTimeout(async () => {
    const ctx = new ProcessExecutionContext({
      processId: 'p-5',
      executionId: 'e-5',
      currentNodeId: 'node-1',
    });
    const { proxy: hostileProcess, revoke } = Proxy.revocable({
      executionGraph: {
        nodesById: { 'node-1': { id: 'node-1' } },
      },
    }, {
      get() { throw new Error('hostile_graph'); },
    });
    revoke();

    const node = ctx.getCurrentNode(hostileProcess);
    expect(node).toBeNull();
  }, 5000));

  test('toSnapshot nao quebra e retorna objeto seguro', withTimeout(async () => {
    const ctx = new ProcessExecutionContext({
      processId: 'p-6',
      executionId: 'e-6',
      currentNodeId: 'n-1',
      status: 'running',
    });

    const snap = ctx.toSnapshot();
    expect(snap.processId).toBe('p-6');
    expect(snap.executionId).toBe('e-6');
    expect(typeof snap.variables).toBe('object');
    expect(Array.isArray(snap.history)).toBe(true);
    expect(typeof snap.metadata).toBe('object');
    expect(typeof snap.recovery).toBe('object');
  }, 5000));
});
