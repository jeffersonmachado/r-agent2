'use strict';

describe('messageProcessor - execution ledger on human handoff', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.ENABLE_EXECUTION_LEDGER = 'true';
  });

  test('finaliza execution ledger quando fluxo entra em handoff ticket', async () => {
    const executeStep = jest.fn().mockResolvedValue({
      state: {
        tenantId: 'tenant-test',
        sessionId: 'whatsapp_5511999999999',
        flowId: 'flow-test',
        flowVersion: 1,
        currentNodeId: 'handoff-node',
        variables: {},
        history: [],
        metadata: {
          executionId: 'fx-123',
          status: 'waiting_human',
          channel: 'whatsapp',
        },
      },
      events: [],
      output: {
        type: 'handoff',
        escalationMode: 'ticket',
        queue: 'default',
        message: 'Encaminhando para atendente...',
      },
    });

    const startFlowExecution = jest.fn().mockResolvedValue({ ok: true, executionId: 'fx-123' });
    const finishFlowExecutionSafe = jest.fn().mockResolvedValue({ ok: true });
    const buildExecutionLedgerAdapter = jest.fn().mockReturnValue({
      executionId: 'fx-123',
      appendNodeExecution: jest.fn().mockResolvedValue({ ok: true }),
    });

    jest.doMock('../../engine/executeStep', () => ({ executeStep }));
    jest.doMock('../../engine/nodeRegistry', () => ({
      NodeRegistry: class NodeRegistry {
        register() {}
      },
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
    jest.doMock('../../engine/nodes/mergeNode', () => ({ mergeNodeHandler: jest.fn() }));
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
    jest.doMock('../../engine/compiledFlowCache', () => ({
      getOrCompileFlow: jest.fn().mockReturnValue({
        id: 'flow-test',
        tenantId: 'tenant-test',
        version: 1,
        nodes: [{ id: 'start-1', type: 'start' }],
      }),
    }));
    jest.doMock('../../engine/services/humanLiveAdapter', () => ({
      createHumanSession: jest.fn(),
      isInHumanSession: jest.fn().mockReturnValue(false),
      getHumanSession: jest.fn(),
    }));
    jest.doMock('../../engine/services/persistenceServices', () => ({}));

    jest.doMock('../../api/services/outboundQueueService', () => ({
      enqueueOutbound: jest.fn().mockResolvedValue({ ok: true }),
    }));
    jest.doMock('../../api/services/queueService', () => ({
      createTicket: jest.fn().mockReturnValue({
        id: 'ticket-1',
        tenantId: 'tenant-test',
        status: 'waiting',
      }),
      getTicketBySession: jest.fn().mockReturnValue(null),
      updateLastMessage: jest.fn(),
      getTicket: jest.fn().mockReturnValue(null),
    }));
    jest.doMock('../../api/services/handoverService', () => ({
      takeOver: jest.fn().mockResolvedValue({ ok: true }),
    }));
    jest.doMock('../../api/services/websocketService', () => ({
      emitEvent: jest.fn(),
    }));
    jest.doMock('../../api/services/planLimitsService', () => ({
      checkLimit: jest.fn().mockResolvedValue({ allowed: true }),
    }));
    jest.doMock('../../engine/aiProviderManager', () => ({
      getAiProviderForTenant: jest.fn().mockReturnValue({}),
    }));
    jest.doMock('../../qa/cdrValidator', () => ({
      validateCDR: jest.fn().mockReturnValue({ status: 'pass' }),
      getSafeResponse: jest.fn().mockReturnValue('safe'),
      generateViolationLog: jest.fn().mockReturnValue({}),
    }));
    jest.doMock('../../lib/replaySystem', () => ({
      ReplaySystem: class ReplaySystem {
        start() {}
        recordEvent() {}
        recordError() {}
        recordAction() {}
        stop() {}
        save() {}
      },
    }));
    jest.doMock('../../lib/recordingSystem', () => ({
      RecordingSystem: class RecordingSystem {
        start() {}
        recordAction() {}
        stop() {}
        save() {}
      },
    }));
    jest.doMock('../../api/services/flowExecutionLedgerService', () => ({
      startFlowExecution,
      finishFlowExecutionSafe,
      buildExecutionLedgerAdapter,
    }));
    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((key) => {
        if (key === 'flows.defaultFlowId') return 'flow-test';
        return null;
      }),
    }));

    const { processWhatsAppMessage } = require('../../api/services/messageProcessor');

    const flows = new Map();
    flows.set('flow-test', {
      id: 'flow-test',
      tenantId: 'tenant-test',
      version: 1,
      nodes: [{ id: 'start-1', type: 'start' }],
    });

    await processWhatsAppMessage(
      {
        from: '5511999999999',
        id: 'wamid-1',
        text: { body: 'oi' },
      },
      {},
      {
        flows,
        sessionEvents: new Map(),
        tenantId: 'tenant-test',
        conversationId: 'conv-1',
        channelType: 'whatsapp',
      },
    );

    expect(startFlowExecution).toHaveBeenCalled();
    expect(finishFlowExecutionSafe).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-test',
      executionId: 'fx-123',
      status: 'done',
      metaPatch: expect.objectContaining({ finishedBy: 'handoff_ticket' }),
    }));
  });
});
