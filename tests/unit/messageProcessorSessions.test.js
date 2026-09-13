'use strict';

describe('messageProcessor - session memory management', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('sweeper remove sessões inativas há mais de 24h e preserva ativas', () => {
    const { _internal } = require('../../api/services/messageProcessor');
    const { sessions, sessionLastAccessAt, sweepIdleSessions, SESSION_IDLE_TTL_MS } = _internal;

    const now = Date.now();
    sessions.set('whatsapp_idle', { sessionId: 'whatsapp_idle' });
    sessionLastAccessAt.set('whatsapp_idle', now - SESSION_IDLE_TTL_MS - 1000);
    sessions.set('whatsapp_active', { sessionId: 'whatsapp_active' });
    sessionLastAccessAt.set('whatsapp_active', now - 1000);

    const removed = sweepIdleSessions(now);

    expect(removed).toBe(1);
    expect(sessions.has('whatsapp_idle')).toBe(false);
    expect(sessionLastAccessAt.has('whatsapp_idle')).toBe(false);
    expect(sessions.has('whatsapp_active')).toBe(true);
  });

  test('sessão é removida quando a conversa termina (sem próximo nó)', async () => {
    const executeStep = jest.fn().mockResolvedValue({
      state: {
        tenantId: 'tenant-test',
        sessionId: 'whatsapp_5511999999999',
        flowId: 'flow-test',
        flowVersion: 1,
        currentNodeId: null,
        variables: {},
        history: [],
        metadata: { channel: 'whatsapp' },
      },
      events: [],
      output: { type: 'message', text: 'Tchau!' },
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
    jest.doMock('../../api/services/humanLiveAdapter', () => ({
      createHumanSession: jest.fn(),
      isInHumanSession: jest.fn().mockReturnValue(false),
      getHumanSession: jest.fn(),
    }));
    jest.doMock('../../engine/services/persistenceServices', () => ({}));
    jest.doMock('../../api/services/outboundQueueService', () => ({
      enqueueOutbound: jest.fn().mockResolvedValue({ ok: true }),
    }));
    jest.doMock('../../api/services/queueService', () => ({
      createTicket: jest.fn(),
      getTicketBySession: jest.fn().mockReturnValue(null),
      updateLastMessage: jest.fn(),
      getTicket: jest.fn().mockReturnValue(null),
    }));
    jest.doMock('../../api/services/websocketService', () => ({
      emitEvent: jest.fn(),
    }));
    jest.doMock('../../api/services/planLimitsService', () => ({
      checkLimit: jest.fn().mockResolvedValue({ allowed: true }),
    }));
    jest.doMock('../../api/services/aiProviderManager.js', () => ({
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
    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((key) => (key === 'flows.defaultFlowId' ? 'flow-test' : null)),
    }));

    process.env.ENABLE_EXECUTION_LEDGER = 'false';
    process.env.ENABLE_MESSAGE_REPLAY = 'false';
    process.env.ENABLE_MESSAGE_RECORDING = 'false';

    const { processWhatsAppMessage, _internal } = require('../../api/services/messageProcessor');

    const flows = new Map();
    flows.set('flow-test', {
      id: 'flow-test',
      tenantId: 'tenant-test',
      version: 1,
      nodes: [{ id: 'start-1', type: 'start' }],
    });

    await processWhatsAppMessage(
      { from: '5511999999999', id: 'wamid-1', text: { body: 'oi' } },
      {},
      {
        flows,
        sessionEvents: new Map(),
        tenantId: 'tenant-test',
        conversationId: 'conv-1',
        channelType: 'whatsapp',
      },
    );

    expect(executeStep).toHaveBeenCalled();
    expect(_internal.sessions.has('whatsapp_5511999999999')).toBe(false);
    expect(_internal.sessionLastAccessAt.has('whatsapp_5511999999999')).toBe(false);
  });
});
