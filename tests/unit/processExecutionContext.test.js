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
});
