describe('voiceRuntimeService idempotency', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('deduplica step com mesmo eventId na mesma sessao', async () => {
    const executeStep = jest.fn(async (state) => ({
      state: { ...state, currentNodeId: state.currentNodeId || 'start-1' },
      output: { type: 'voice', action: 'say', waitForInput: true },
      events: [],
    }));

    jest.doMock('../../engine/executeStep', () => ({ executeStep }));
    jest.doMock('../../engine/nodeRegistry', () => ({
      NodeRegistry: class {
        register() {}
      },
    }));
    jest.doMock('../../engine/compiledFlowCache', () => ({
      getOrCompileFlow: (f) => f,
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));
    jest.doMock('../../api/services/aiProviderManager.js', () => ({
      getAiProviderForTenant: () => null,
    }));
    jest.doMock('../../engine/nodes/basicNodes', () => ({
      startNodeHandler: jest.fn(),
      messageNodeHandler: jest.fn(),
      userInputNodeHandler: jest.fn(),
      routerNodeHandler: jest.fn(),
      scheduleRouterNodeHandler: jest.fn(),
      setVariableNodeHandler: jest.fn(),
      handoffNodeHandler: jest.fn(),
      endNodeHandler: jest.fn(),
      optionsNodeHandler: jest.fn(),
      subflowNodeHandler: jest.fn(),
    }));
    jest.doMock('../../engine/nodes/mergeNode', () => ({ mergeNodeHandler: jest.fn() }));
    jest.doMock('../../engine/nodes/aiNode', () => ({ aiNodeHandler: jest.fn() }));
    jest.doMock('../../engine/nodes/aiTaskNode', () => ({ aiTaskNodeHandler: jest.fn() }));
    jest.doMock('../../engine/nodes/semanticRouterNode', () => ({ semanticRouterNodeHandler: jest.fn() }));
    jest.doMock('../../engine/nodes/ragAnswerNode', () => ({ ragAnswerNodeHandler: jest.fn() }));
    jest.doMock('../../engine/nodes/businessEntryNode', () => ({ businessEntryNodeHandler: jest.fn() }));
    jest.doMock('../../engine/nodes/persistenceNodes', () => ({
      getFlowInfoNodeHandler: jest.fn(),
      getQueueStatusNodeHandler: jest.fn(),
      getConfigValueNodeHandler: jest.fn(),
      listFlowsNodeHandler: jest.fn(),
    }));
    jest.doMock('../../engine/nodes/systemNodes', () => ({
      getCurrentTimeNodeHandler: jest.fn(),
      generateUuidNodeHandler: jest.fn(),
      delayNodeHandler: jest.fn(),
      formatDateNodeHandler: jest.fn(),
      randomNumberNodeHandler: jest.fn(),
      getUserInfoNodeHandler: jest.fn(),
    }));
    jest.doMock('../../engine/nodes/apiNode', () => ({ apiNodeHandler: jest.fn() }));
    jest.doMock('../../engine/nodes/fallbackNode', () => ({ fallbackNodeHandler: jest.fn() }));
    jest.doMock('../../engine/nodes/voiceNodes', () => ({
      voicePromptListenNodeHandler: jest.fn(),
      voiceListenAsrNodeHandler: jest.fn(),
      voiceGatherDtmfNodeHandler: jest.fn(),
      voiceBranchNodeHandler: jest.fn(),
      voiceTransferRamalNodeHandler: jest.fn(),
      voiceTransferFilaNodeHandler: jest.fn(),
      voiceTransferUtilsNodeHandler: jest.fn(),
      voiceHangupNodeHandler: jest.fn(),
    }));
    jest.doMock('../../engine/services/persistenceServices', () => ({
      getFlow: jest.fn(async () => ({
        id: 'flow-1',
        tenantId: 't1',
        kind: 'voice',
        version: 1,
        nodes: [{ id: 'start-1', type: 'start' }],
      })),
    }));
    jest.doMock('../../api/services/flowExecutionLedgerService', () => ({
      startFlowExecution: jest.fn(async () => ({ ok: true, executionId: 'exec-1' })),
      finishFlowExecutionSafe: jest.fn(async () => ({ ok: true })),
      buildExecutionLedgerAdapter: jest.fn(() => null),
    }));

    const svc = require('../../api/services/voiceRuntimeService');
    await svc.clearVoiceSession({ tenantId: 't1', callId: 'call-1' });

    const r1 = await svc.runVoiceSession({
      tenantId: 't1',
      flowId: 'flow-1',
      callId: 'call-1',
      input: { eventId: 'evt-1', text: 'oi' },
    });
    expect(r1.ok).toBe(true);

    const r2 = await svc.runVoiceSession({
      tenantId: 't1',
      flowId: 'flow-1',
      callId: 'call-1',
      input: { eventId: 'evt-1', text: 'oi' },
    });
    expect(r2.ok).toBe(true);
    expect(r2.deduplicated).toBe(true);
    expect(executeStep).toHaveBeenCalledTimes(1);
  });
});
