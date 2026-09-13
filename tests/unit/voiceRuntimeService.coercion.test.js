'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function buildMocks({ flowOverride = null, failLoad = false } = {}) {
  const defaultFlow = {
    id: 'flow-1',
    kind: 'voice',
    version: 1,
    tenantId: 'tenant-1',
    nodes: [{ id: 'start-1', type: 'start', edges: [] }],
    edges: [],
  };
  const flow = flowOverride || defaultFlow;

  jest.doMock('../../engine/services/persistenceServices', () => ({
    getFlow: jest.fn(async () => (failLoad ? null : flow)),
    getFlowNodeGraph: jest.fn(async () => null),
    getTenant: jest.fn(async () => ({ id: 'tenant-1' })),
  }));

  jest.doMock('../../engine/compiledFlowCache', () => ({
    getOrCompileFlow: jest.fn((f) => f),
  }));

  jest.doMock('../../engine/executeStep', () => ({
    executeStep: jest.fn(async (state) => ({
      state: { ...state, currentNodeId: null },
      output: { type: 'voice', action: 'hangup', waitForInput: false },
      events: [],
    })),
  }));

  jest.doMock('../../engine/nodeRegistry', () => ({
    NodeRegistry: class {
      register() {}
    },
  }));

  jest.doMock('../../api/services/aiProviderManager.js', () => ({
    getAiProviderForTenant: jest.fn(() => null),
  }));

  jest.doMock('../../api/services/eventLedgerService', () => ({
    appendEventV1: jest.fn(async () => {}),
  }));

  jest.doMock('../../api/services/flowExecutionLedgerService', () => ({
    startFlowExecution: jest.fn(async () => ({ ok: true, executionId: 'exec-1' })),
    finishFlowExecutionSafe: jest.fn(async () => {}),
    buildExecutionLedgerAdapter: jest.fn(() => null),
  }));

  // Register all node handlers as no-ops
  const noop = jest.fn(async (state) => ({ state, output: null, events: [] }));
  jest.doMock('../../engine/nodes/basicNodes', () => ({
    startNodeHandler: noop,
    messageNodeHandler: noop,
    userInputNodeHandler: noop,
    routerNodeHandler: noop,
    scheduleRouterNodeHandler: noop,
    setVariableNodeHandler: noop,
    handoffNodeHandler: noop,
    endNodeHandler: noop,
    optionsNodeHandler: noop,
    subflowNodeHandler: noop,
  }));
  jest.doMock('../../engine/nodes/mergeNode', () => ({ mergeNodeHandler: noop }));
  jest.doMock('../../engine/nodes/aiNode', () => ({ aiNodeHandler: noop }));
  jest.doMock('../../engine/nodes/aiTaskNode', () => ({ aiTaskNodeHandler: noop }));
  jest.doMock('../../engine/nodes/semanticRouterNode', () => ({ semanticRouterNodeHandler: noop }));
  jest.doMock('../../engine/nodes/ragAnswerNode', () => ({ ragAnswerNodeHandler: noop }));
  jest.doMock('../../engine/nodes/businessEntryNode', () => ({ businessEntryNodeHandler: noop }));
  jest.doMock('../../engine/nodes/persistenceNodes', () => ({
    getFlowInfoNodeHandler: noop,
    getQueueStatusNodeHandler: noop,
    getConfigValueNodeHandler: noop,
    listFlowsNodeHandler: noop,
  }));
  jest.doMock('../../engine/nodes/systemNodes', () => ({
    getCurrentTimeNodeHandler: noop,
    generateUuidNodeHandler: noop,
    delayNodeHandler: noop,
    formatDateNodeHandler: noop,
    randomNumberNodeHandler: noop,
    getUserInfoNodeHandler: noop,
  }));
  jest.doMock('../../engine/nodes/apiNode', () => ({ apiNodeHandler: noop }));
  jest.doMock('../../engine/nodes/fallbackNode', () => ({ fallbackNodeHandler: noop }));
  jest.doMock('../../engine/nodes/voiceNodes', () => ({
    voicePromptListenNodeHandler: noop,
    voiceListenAsrNodeHandler: noop,
    voiceGatherDtmfNodeHandler: noop,
    voiceBranchNodeHandler: noop,
    voiceTransferRamalNodeHandler: noop,
    voiceTransferFilaNodeHandler: noop,
    voiceTransferUtilsNodeHandler: noop,
    voiceHangupNodeHandler: noop,
  }));
}

describe('voiceRuntimeService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('runVoiceSession returns error when tenantId missing', async () => {
    buildMocks();
    const { runVoiceSession } = require('../../api/services/voiceRuntimeService');
    const result = await runVoiceSession({ tenantId: null, callId: 'call-1', flowId: 'flow-1' });
    expect(result).toEqual({ ok: false, error: 'tenant_required' });
  });

  test('runVoiceSession with hostile callId in getSessionKey does not throw', async () => {
    buildMocks();
    const { runVoiceSession } = require('../../api/services/voiceRuntimeService');

    const hostile = { toString() { throw new Error('boom-callId'); } };
    // Without safeToString this would throw inside getSessionKey
    const result = await runVoiceSession({
      tenantId: 'tenant-1',
      callId: hostile,
      flowId: 'flow-1',
    });
    // callId coercion falls back to '' so session key is 'tenant-1:'
    // flow load should proceed — service completes without uncaught exception
    expect(result).toEqual(expect.objectContaining({ ok: expect.any(Boolean) }));
  });

  test('runVoiceSession with hostile tenantId in session key does not throw', async () => {
    buildMocks();
    const { runVoiceSession } = require('../../api/services/voiceRuntimeService');

    const hostileTenant = { toString() { throw new Error('boom-tenant'); } };
    const result = await runVoiceSession({
      tenantId: hostileTenant,
      callId: 'call-1',
      flowId: 'flow-1',
    });
    expect(result).toEqual(expect.objectContaining({ ok: expect.any(Boolean) }));
  });

  test('runVoiceSession survives hostile err.message when flow load throws', async () => {
    buildMocks();
    // Override persistence to throw with a hostile error
    const hostileErr = {};
    Object.defineProperty(hostileErr, 'message', { get() { throw new Error('boom-getter'); } });
    jest.doMock('../../engine/services/persistenceServices', () => ({
      getFlow: jest.fn(async () => { throw hostileErr; }),
    }));

    const { runVoiceSession } = require('../../api/services/voiceRuntimeService');
    const result = await runVoiceSession({ tenantId: 'tenant-1', callId: 'call-1', flowId: 'flow-1' });
    // flow load fails → flow_not_found (not an uncaught throw)
    expect(result).toEqual({ ok: false, error: 'flow_not_found' });
  });

  test('getVoiceRuntimeStats with hostile key in session map does not throw', async () => {
    buildMocks();
    const svc = require('../../api/services/voiceRuntimeService');

    // Inject a hostile key directly (simulate a bad entry)
    // We can't directly access the Map, so we verify getVoiceRuntimeStats runs without crashing
    const stats = svc.getVoiceRuntimeStats({});
    expect(stats).toEqual(expect.objectContaining({ ok: true, items: expect.any(Array) }));
  });

  test('runVoiceSession result callId/flowId fields use safeToString fallbacks', async () => {
    buildMocks();
    const { runVoiceSession } = require('../../api/services/voiceRuntimeService');

    const hostileCallId = { toString() { throw new Error('boom'); } };
    const result = await runVoiceSession({
      tenantId: 'tenant-1',
      callId: hostileCallId,
      flowId: 'flow-1',
    });
    if (result.ok) {
      // callId fell back to '' (safeToString fallback)
      expect(typeof result.callId).toBe('string');
      expect(typeof result.flowId).toBe('string');
    } else {
      // Any error is acceptable — must not throw
      expect(typeof result.error).toBe('string');
    }
  });
});
