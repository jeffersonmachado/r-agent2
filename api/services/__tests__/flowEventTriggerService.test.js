'use strict';

jest.mock('../../../engine/compiledFlowCache', () => ({
  getOrCompileFlow: jest.fn(),
}));

jest.mock('../../../engine/executeStep', () => ({
  executeStep: jest.fn(),
}));

jest.mock('../aiProviderManager.js', () => ({
  getAiProviderForTenant: jest.fn(() => ({ provider: 'mock' })),
}));

jest.mock('../../../engine/services/persistenceServices', () => ({}));

jest.mock('../flowExecutionLedgerService', () => {
  const actual = jest.requireActual('../flowExecutionLedgerService');
  return {
    ...actual,
    startFlowExecution: jest.fn(),
    finishFlowExecutionSafe: jest.fn(() => Promise.resolve({ ok: true })),
    buildExecutionLedgerAdapter: jest.fn(() => ({
      executionId: 'fx-mock',
      appendNodeExecution: jest.fn(),
    })),
  };
});

const { getOrCompileFlow } = require('../../../engine/compiledFlowCache');
const { executeStep } = require('../../../engine/executeStep');
const persistence = require('../../../engine/services/persistenceServices');
const {
  startFlowExecution,
  finishFlowExecutionSafe,
} = require('../flowExecutionLedgerService');
const { executeFlowForEvent, dispatchFlowsForEvent } = require('../flowEventTriggerService');

describe('flowEventTriggerService.executeFlowForEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EVENT_TRIGGER_STRICT_FAILURES;
    finishFlowExecutionSafe.mockResolvedValue({ ok: true });
    const { buildExecutionLedgerAdapter } = require('../flowExecutionLedgerService');
    buildExecutionLedgerAdapter.mockReturnValue({
      executionId: 'fx-mock',
      appendNodeExecution: jest.fn(),
    });
  });

  test('reused execution skips runtime execution', async () => {
    const flow = { id: 'flow-1', tenantId: 't1', nodes: [{ id: 'start', type: 'start' }] };
    getOrCompileFlow.mockReturnValue(flow);
    startFlowExecution.mockResolvedValue({ ok: true, executionId: 'fx1', reused: true });

    const out = await executeFlowForEvent({
      tenantId: 't1',
      flow,
      event: { id: 'ev1', type: 'CallRinging' },
    });

    expect(out.ok).toBe(true);
    expect(out.reused).toBe(true);
    expect(out.steps).toBe(0);
    expect(executeStep).not.toHaveBeenCalled();
    expect(finishFlowExecutionSafe).not.toHaveBeenCalled();
  });

  test('errors in executeStep mark execution as failed', async () => {
    const flow = { id: 'flow-2', tenantId: 't2', nodes: [{ id: 'start', type: 'start' }] };
    getOrCompileFlow.mockReturnValue(flow);
    startFlowExecution.mockResolvedValue({ ok: true, executionId: 'fx2' });
    executeStep.mockRejectedValue(new Error('boom'));

    await expect(executeFlowForEvent({
      tenantId: 't2',
      flow,
      event: { id: 'ev2', type: 'CallAnswered' },
      maxSteps: 1,
    })).rejects.toThrow('boom');

    expect(finishFlowExecutionSafe).toHaveBeenCalledWith({
      tenantId: 't2',
      executionId: 'fx2',
      status: 'failed',
      metaPatch: { error: 'boom' },
    });
  });

  test('dispatchFlowsForEvent throws when strict mode and matching flow fails', async () => {
    const flow = {
      id: 'flow-strict-fail',
      tenantId: 'tenant-1',
      nodes: [{ id: 'start', type: 'start' }],
      metadata: { eventTriggers: [{ type: 'CallRinging' }] },
    };
    persistence.getFlows = jest.fn().mockResolvedValue([flow]);
    getOrCompileFlow.mockReturnValue(flow);
    startFlowExecution.mockRejectedValue(new Error('start_fail'));

    await expect(dispatchFlowsForEvent({
      tenantId: 'tenant-1',
      event: { id: 'ev3', type: 'CallRinging' },
    })).rejects.toMatchObject({ message: 'event_trigger_flows_failed' });
  });

  test('dispatchFlowsForEvent keeps best-effort when strict mode disabled', async () => {
    process.env.EVENT_TRIGGER_STRICT_FAILURES = 'false';
    const flow = {
      id: 'flow-best-effort',
      tenantId: 'tenant-1',
      nodes: [{ id: 'start', type: 'start' }],
      metadata: { eventTriggers: [{ type: 'CallRinging' }] },
    };
    persistence.getFlows = jest.fn().mockResolvedValue([flow]);
    getOrCompileFlow.mockReturnValue(flow);
    startFlowExecution.mockRejectedValue(new Error('start_fail'));

    const out = await dispatchFlowsForEvent({
      tenantId: 'tenant-1',
      event: { id: 'ev4', type: 'CallRinging' },
    });

    expect(out.ok).toBe(true);
    expect(out.matched).toBe(1);
    expect(out.executed).toBe(0);
    expect(out.failed).toBe(1);
    expect(out.failures).toHaveLength(1);
  });
});
