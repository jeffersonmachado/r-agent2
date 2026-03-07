'use strict';

jest.mock('../../utils/redisClient', () => ({
  getRedisClientOrNull: jest.fn(() => null),
}));

jest.mock('../../../engine/executeStep', () => ({
  executeStep: jest.fn(),
}));

jest.mock('../../../engine/compiledFlowCache', () => ({
  getOrCompileFlow: jest.fn((f) => f),
}));

jest.mock('../outboundQueueService', () => ({
  enqueueOutbound: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../planLimitsService', () => ({
  checkLimit: jest.fn(async () => ({ allowed: true, limit: 9999, current: 1 })),
}));

jest.mock('../handoverService', () => ({
  takeOver: jest.fn(async () => ({ ok: true })),
}));

describe('messageProcessor handoff -> ticket with normalized context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('cria ticket com tags e normalized_context no payload', async () => {
    jest.resetModules();
    const { executeStep } = require('../../../engine/executeStep');
    executeStep.mockImplementation(async (state) => ({
      state: {
        ...state,
        metadata: {
          ...(state.metadata || {}),
        },
      },
      output: {
        type: 'handoff',
        queue: 'support',
        message: 'Vou transferir para um atendente humano.',
      },
      events: [{ type: 'step', timestamp: new Date().toISOString() }],
    }));

    const queueService = require('../queueService');
    const createTicketSpy = jest.spyOn(queueService, 'createTicket');
    const { processNormalizedInboundEvent } = require('../messageProcessor');

    const flows = new Map();
    flows.set('flow-handoff', {
      id: 'flow-handoff',
      tenantId: 'tenant-h1',
      version: 1,
      kind: 'chat',
      nodes: [
        { id: 'start', type: 'start', next: 'handoff' },
        { id: 'handoff', type: 'handoff' },
      ],
    });

    const deps = {
      flows,
      sessionEvents: new Map(),
      flowId: 'flow-handoff',
      saveSessionEvents: jest.fn(),
    };

    const sessionId = `sess-handoff-${Date.now()}`;

    await processNormalizedInboundEvent({
      event_type: 'message',
      channel: 'whatsapp',
      media: 'text',
      direction: 'inbound',
      tenant_id: 'tenant-h1',
      lead_id: '5511999999999',
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      trace_id: 'trace-h1',
      correlation_id: 'corr-h1',
      tags: ['topic:suporte'],
      payload: { text: 'Preciso de um humano para resolver erro no pedido #AB1234' },
      metadata: {},
      voice_metadata: {},
    }, deps);

    expect(createTicketSpy).toHaveBeenCalledTimes(1);
    const payload = createTicketSpy.mock.calls[0][0];

    expect(payload.tenantId).toBe('tenant-h1');
    expect(payload.sessionId).toBe(sessionId);
    expect(Array.isArray(payload.tags)).toBe(true);
    expect(payload.tags.some((t) => String(t).startsWith('intent:'))).toBe(true);
    expect(payload.context.normalized_context).toBeTruthy();
    expect(payload.context.metadata.normalized_context).toBeTruthy();
    expect(payload.context.normalized_context.session_id).toBe(sessionId);
    expect(payload.context.normalized_context.entities.order_id.value).toBe('ab1234');
  });
});
