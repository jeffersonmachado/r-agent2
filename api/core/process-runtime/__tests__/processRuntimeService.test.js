'use strict';

const { ProcessRuntimeService } = require('../processRuntimeService');

describe('ProcessRuntimeService', () => {
  test('executa processo canônico via adapter legado', async () => {
    const executeStepImpl = jest.fn(async (state) => ({
      state: { ...state, currentNodeId: 'end_1' },
      events: [],
      output: { type: 'message', text: 'ok' },
    }));

    const compileFlowImpl = jest.fn((flow) => ({ ...flow, versionHash: 'compiled_hash' }));
    const getOrCompileFlowImpl = jest.fn((flow) => ({ ...flow, versionHash: 'legacy_hash' }));

    const runtime = new ProcessRuntimeService({
      executeStepImpl,
      compileFlowImpl,
      getOrCompileFlowImpl,
    });

    const canonical = {
      id: 'proc_runtime',
      name: 'Proc Runtime',
      version: 1,
      metadata: { tenantId: 'tenant_1' },
      nodes: [
        { id: 'start_1', type: 'start', config: {} },
        { id: 'task_1', type: 'task.service', config: { action: 'x' } },
        { id: 'end_1', type: 'end', config: {} },
      ],
      edges: [
        { source: 'start_1', target: 'task_1', priority: 0 },
        { source: 'task_1', target: 'end_1', priority: 0 },
      ],
      entrypoints: ['start_1'],
    };

    const state = {
      tenantId: 'tenant_1',
      sessionId: 'sess_1',
      flowId: 'proc_runtime',
      flowVersion: 1,
      currentNodeId: 'start_1',
      variables: {},
      history: [],
    };

    const result = await runtime.executeStep(state, canonical, { registry: {} });

    expect(result.runtime.format).toBe('canonical');
    expect(executeStepImpl).toHaveBeenCalledTimes(1);
    expect(compileFlowImpl).toHaveBeenCalledTimes(1);
    expect(getOrCompileFlowImpl).toHaveBeenCalledTimes(0);

    const metrics = runtime.observabilityService.snapshot();
    expect(metrics.nodeEnter).toBeGreaterThan(0);
  });
});
