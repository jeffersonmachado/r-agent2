'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('flowEventTriggerService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('listMatchingFlows does not throw with hostile tenantId coercion', async () => {
    jest.doMock('../../engine/services/persistenceServices', () => ({
      getFlows: jest.fn(async () => [
        { id: 'flow-1', tenantId: 'tenant-1', metadata: { eventTriggers: [{ type: 'CallRinging' }] } },
      ]),
    }));
    jest.doMock('../../engine/compiledFlowCache', () => ({ getOrCompileFlow: jest.fn((f) => f) }));
    jest.doMock('../../engine/executeStep', () => ({ executeStep: jest.fn() }));
    jest.doMock('../../engine/nodeRegistry', () => ({ NodeRegistry: class { register() {} } }));
    jest.doMock('../../api/services/aiProviderManager.js', () => ({ getAiProviderForTenant: jest.fn(() => ({})) }));
    jest.doMock('../../api/services/flowExecutionLedgerService', () => ({
      startFlowExecution: jest.fn(async () => ({ ok: true, executionId: 'fx-1' })),
      finishFlowExecutionSafe: jest.fn(async () => ({})),
      buildExecutionLedgerAdapter: jest.fn(() => null),
    }));
    jest.doMock('../../engine/nodes/basicNodes', () => ({
      startNodeHandler: {}, messageNodeHandler: {}, userInputNodeHandler: {},
      routerNodeHandler: {}, scheduleRouterNodeHandler: {}, setVariableNodeHandler: {},
      handoffNodeHandler: {}, endNodeHandler: {}, optionsNodeHandler: {}, subflowNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/aiNode', () => ({ aiNodeHandler: {} }));
    jest.doMock('../../engine/nodes/aiTaskNode', () => ({ aiTaskNodeHandler: {} }));
    jest.doMock('../../engine/nodes/semanticRouterNode', () => ({ semanticRouterNodeHandler: {} }));
    jest.doMock('../../engine/nodes/ragAnswerNode', () => ({ ragAnswerNodeHandler: {} }));
    jest.doMock('../../engine/nodes/businessEntryNode', () => ({ businessEntryNodeHandler: {} }));
    jest.doMock('../../engine/nodes/mergeNode', () => ({ mergeNodeHandler: {} }));
    jest.doMock('../../engine/nodes/persistenceNodes', () => ({
      getFlowInfoNodeHandler: {}, getQueueStatusNodeHandler: {},
      getConfigValueNodeHandler: {}, listFlowsNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/systemNodes', () => ({
      getCurrentTimeNodeHandler: {}, generateUuidNodeHandler: {}, delayNodeHandler: {},
      formatDateNodeHandler: {}, randomNumberNodeHandler: {}, getUserInfoNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/apiNode', () => ({ apiNodeHandler: {} }));
    jest.doMock('../../engine/nodes/fallbackNode', () => ({ fallbackNodeHandler: {} }));

    const { listMatchingFlows } = require('../../api/services/flowEventTriggerService');

    const out = await listMatchingFlows({
      tenantId: { toString: () => { throw new Error('boom-tenant'); } },
      event: { type: 'CallRinging' },
    });

    // hostile tenantId coerces to '' which matches no tenant filter
    expect(Array.isArray(out)).toBe(true);
  });

  test('normalizeTrigger handles hostile field coercions without throwing', async () => {
    jest.doMock('../../engine/services/persistenceServices', () => ({
      getFlows: jest.fn(async () => []),
    }));
    jest.doMock('../../engine/compiledFlowCache', () => ({ getOrCompileFlow: jest.fn((f) => f) }));
    jest.doMock('../../engine/executeStep', () => ({ executeStep: jest.fn() }));
    jest.doMock('../../engine/nodeRegistry', () => ({ NodeRegistry: class { register() {} } }));
    jest.doMock('../../api/services/aiProviderManager.js', () => ({ getAiProviderForTenant: jest.fn(() => ({})) }));
    jest.doMock('../../api/services/flowExecutionLedgerService', () => ({
      startFlowExecution: jest.fn(async () => ({ ok: true, executionId: 'fx-1' })),
      finishFlowExecutionSafe: jest.fn(async () => ({})),
      buildExecutionLedgerAdapter: jest.fn(() => null),
    }));
    jest.doMock('../../engine/nodes/basicNodes', () => ({
      startNodeHandler: {}, messageNodeHandler: {}, userInputNodeHandler: {},
      routerNodeHandler: {}, scheduleRouterNodeHandler: {}, setVariableNodeHandler: {},
      handoffNodeHandler: {}, endNodeHandler: {}, optionsNodeHandler: {}, subflowNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/aiNode', () => ({ aiNodeHandler: {} }));
    jest.doMock('../../engine/nodes/aiTaskNode', () => ({ aiTaskNodeHandler: {} }));
    jest.doMock('../../engine/nodes/semanticRouterNode', () => ({ semanticRouterNodeHandler: {} }));
    jest.doMock('../../engine/nodes/ragAnswerNode', () => ({ ragAnswerNodeHandler: {} }));
    jest.doMock('../../engine/nodes/businessEntryNode', () => ({ businessEntryNodeHandler: {} }));
    jest.doMock('../../engine/nodes/mergeNode', () => ({ mergeNodeHandler: {} }));
    jest.doMock('../../engine/nodes/persistenceNodes', () => ({
      getFlowInfoNodeHandler: {}, getQueueStatusNodeHandler: {},
      getConfigValueNodeHandler: {}, listFlowsNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/systemNodes', () => ({
      getCurrentTimeNodeHandler: {}, generateUuidNodeHandler: {}, delayNodeHandler: {},
      formatDateNodeHandler: {}, randomNumberNodeHandler: {}, getUserInfoNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/apiNode', () => ({ apiNodeHandler: {} }));
    jest.doMock('../../engine/nodes/fallbackNode', () => ({ fallbackNodeHandler: {} }));

    const svc = require('../../api/services/flowEventTriggerService');

    // Call dispatchFlowsForEvent with a hostile event whose fields throw on String()
    const result = await svc.dispatchFlowsForEvent({
      tenantId: 'tenant-1',
      event: {
        id: { toString: () => { throw new Error('boom-id'); } },
        type: { toString: () => { throw new Error('boom-type'); } },
        source: { toString: () => { throw new Error('boom-source'); } },
      },
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, matched: 0 }));
  });

  test('executeFlowForEvent returns invalid_args when tenantId coercion is hostile', async () => {
    jest.doMock('../../engine/services/persistenceServices', () => ({
      getFlows: jest.fn(async () => []),
    }));
    jest.doMock('../../engine/compiledFlowCache', () => ({ getOrCompileFlow: jest.fn((f) => f) }));
    jest.doMock('../../engine/executeStep', () => ({ executeStep: jest.fn() }));
    jest.doMock('../../engine/nodeRegistry', () => ({ NodeRegistry: class { register() {} } }));
    jest.doMock('../../api/services/aiProviderManager.js', () => ({ getAiProviderForTenant: jest.fn(() => ({})) }));
    jest.doMock('../../api/services/flowExecutionLedgerService', () => ({
      startFlowExecution: jest.fn(async () => ({ ok: true, executionId: 'fx-1' })),
      finishFlowExecutionSafe: jest.fn(async () => ({})),
      buildExecutionLedgerAdapter: jest.fn(() => null),
    }));
    jest.doMock('../../engine/nodes/basicNodes', () => ({
      startNodeHandler: {}, messageNodeHandler: {}, userInputNodeHandler: {},
      routerNodeHandler: {}, scheduleRouterNodeHandler: {}, setVariableNodeHandler: {},
      handoffNodeHandler: {}, endNodeHandler: {}, optionsNodeHandler: {}, subflowNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/aiNode', () => ({ aiNodeHandler: {} }));
    jest.doMock('../../engine/nodes/aiTaskNode', () => ({ aiTaskNodeHandler: {} }));
    jest.doMock('../../engine/nodes/semanticRouterNode', () => ({ semanticRouterNodeHandler: {} }));
    jest.doMock('../../engine/nodes/ragAnswerNode', () => ({ ragAnswerNodeHandler: {} }));
    jest.doMock('../../engine/nodes/businessEntryNode', () => ({ businessEntryNodeHandler: {} }));
    jest.doMock('../../engine/nodes/mergeNode', () => ({ mergeNodeHandler: {} }));
    jest.doMock('../../engine/nodes/persistenceNodes', () => ({
      getFlowInfoNodeHandler: {}, getQueueStatusNodeHandler: {},
      getConfigValueNodeHandler: {}, listFlowsNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/systemNodes', () => ({
      getCurrentTimeNodeHandler: {}, generateUuidNodeHandler: {}, delayNodeHandler: {},
      formatDateNodeHandler: {}, randomNumberNodeHandler: {}, getUserInfoNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/apiNode', () => ({ apiNodeHandler: {} }));
    jest.doMock('../../engine/nodes/fallbackNode', () => ({ fallbackNodeHandler: {} }));

    const svc = require('../../api/services/flowEventTriggerService');
    const flow = { id: 'flow-1', nodes: [{ id: 'n1', type: 'start' }] };

    const out = await svc.executeFlowForEvent({
      tenantId: { toString: () => { throw new Error('boom-tenant'); } },
      flow,
      event: { id: 'evt-1', type: 'CallRinging' },
    });

    expect(out).toEqual({ ok: false, reason: 'invalid_args' });
  });

  test('dispatchFlowsForEvent tolerates hostile error.message getter', async () => {
    const prevStrict = process.env.EVENT_TRIGGER_STRICT_FAILURES;
    process.env.EVENT_TRIGGER_STRICT_FAILURES = 'false';

    try {

    jest.doMock('../../engine/services/persistenceServices', () => ({
      getFlows: jest.fn(async () => [
        {
          id: 'flow-1',
          tenantId: 'tenant-1',
          metadata: { eventTriggers: [{ type: 'CallRinging' }] },
          nodes: [{ id: 'start-1', type: 'start' }],
        },
      ]),
    }));
    jest.doMock('../../engine/compiledFlowCache', () => ({ getOrCompileFlow: jest.fn((f) => f) }));
    jest.doMock('../../engine/executeStep', () => ({
      executeStep: jest.fn(async () => {
        const err = {};
        Object.defineProperty(err, 'message', {
          get() { throw new Error('boom-message-getter'); },
        });
        err.toString = () => { throw new Error('boom-toString'); };
        throw err;
      }),
    }));
    jest.doMock('../../engine/nodeRegistry', () => ({ NodeRegistry: class { register() {} } }));
    jest.doMock('../../api/services/aiProviderManager.js', () => ({ getAiProviderForTenant: jest.fn(() => ({})) }));
    jest.doMock('../../api/services/flowExecutionLedgerService', () => ({
      startFlowExecution: jest.fn(async () => ({ ok: true, executionId: 'fx-1' })),
      finishFlowExecutionSafe: jest.fn(async () => ({})),
      buildExecutionLedgerAdapter: jest.fn(() => null),
    }));
    jest.doMock('../../engine/nodes/basicNodes', () => ({
      startNodeHandler: {}, messageNodeHandler: {}, userInputNodeHandler: {},
      routerNodeHandler: {}, scheduleRouterNodeHandler: {}, setVariableNodeHandler: {},
      handoffNodeHandler: {}, endNodeHandler: {}, optionsNodeHandler: {}, subflowNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/aiNode', () => ({ aiNodeHandler: {} }));
    jest.doMock('../../engine/nodes/aiTaskNode', () => ({ aiTaskNodeHandler: {} }));
    jest.doMock('../../engine/nodes/semanticRouterNode', () => ({ semanticRouterNodeHandler: {} }));
    jest.doMock('../../engine/nodes/ragAnswerNode', () => ({ ragAnswerNodeHandler: {} }));
    jest.doMock('../../engine/nodes/businessEntryNode', () => ({ businessEntryNodeHandler: {} }));
    jest.doMock('../../engine/nodes/mergeNode', () => ({ mergeNodeHandler: {} }));
    jest.doMock('../../engine/nodes/persistenceNodes', () => ({
      getFlowInfoNodeHandler: {}, getQueueStatusNodeHandler: {},
      getConfigValueNodeHandler: {}, listFlowsNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/systemNodes', () => ({
      getCurrentTimeNodeHandler: {}, generateUuidNodeHandler: {}, delayNodeHandler: {},
      formatDateNodeHandler: {}, randomNumberNodeHandler: {}, getUserInfoNodeHandler: {},
    }));
    jest.doMock('../../engine/nodes/apiNode', () => ({ apiNodeHandler: {} }));
    jest.doMock('../../engine/nodes/fallbackNode', () => ({ fallbackNodeHandler: {} }));

    const svc = require('../../api/services/flowEventTriggerService');

    const out = await svc.dispatchFlowsForEvent({
      tenantId: 'tenant-1',
      event: { id: 'evt-1', type: 'CallRinging' },
    });

      expect(out.ok).toBe(true);
      expect(out.matched).toBe(1);
      expect(out.failed).toBe(1);
      expect(Array.isArray(out.failures)).toBe(true);
    } finally {
      if (prevStrict === undefined) {
        delete process.env.EVENT_TRIGGER_STRICT_FAILURES;
      } else {
        process.env.EVENT_TRIGGER_STRICT_FAILURES = prevStrict;
      }
    }
  });
});
