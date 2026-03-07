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

const { processNormalizedInboundEvent } = require('../messageProcessor');
const { executeStep } = require('../../../engine/executeStep');

describe('messageProcessor smoke (normalized event)', () => {
  beforeEach(() => {
    executeStep.mockImplementation(async (state, _flow, ctx) => ({
      state: {
        ...state,
        metadata: {
          ...(state.metadata || {}),
        },
      },
      output: {
        type: 'message',
        text: `Recebido: ${ctx?.input?.text || ''}`,
      },
      events: [{ type: 'step', timestamp: new Date().toISOString() }],
    }));
  });

  test('processa 3 mensagens no mesmo session_id e evolui stage', async () => {
    const flows = new Map();
    flows.set('flow-test', {
      id: 'flow-test',
      tenantId: 'tenant-smoke',
      version: 1,
      kind: 'chat',
      nodes: [
        { id: 'start', type: 'start', next: 'end' },
        { id: 'end', type: 'end' },
      ],
    });

    const deps = {
      flows,
      sessionEvents: new Map(),
      flowId: 'flow-test',
      saveSessionEvents: jest.fn(),
    };

    const base = {
      event_type: 'message',
      channel: 'whatsapp',
      media: 'text',
      direction: 'inbound',
      tenant_id: 'tenant-smoke',
      lead_id: '551100000000',
      session_id: 'sess-smoke-1',
      voice_metadata: {},
      metadata: {},
      correlation_id: 'corr-smoke-1',
    };

    const r1 = await processNormalizedInboundEvent({
      ...base,
      timestamp: new Date().toISOString(),
      trace_id: 'trace-1',
      tags: ['intent:sales'],
      payload: { text: 'Quero preço e planos' },
    }, deps);

    const r2 = await processNormalizedInboundEvent({
      ...base,
      timestamp: new Date().toISOString(),
      trace_id: 'trace-2',
      payload: { text: 'Tenho interesse em contratar ainda hoje, meu email é ana@example.com' },
    }, deps);

    const r3 = await processNormalizedInboundEvent({
      ...base,
      timestamp: new Date().toISOString(),
      trace_id: 'trace-3',
      tags: ['topic:orcamento'],
      payload: { text: 'Pode fechar, pedido #XPTO123, quero avançar na compra' },
    }, deps);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(r1.state.metadata.last_stage).toBe('interest');
    expect(r2.state.metadata.last_stage).toBe('consideration');
    expect(r3.state.metadata.last_stage).toBe('decision');
    expect(r3.state.tags).toEqual(expect.arrayContaining(['intent:sales', 'severity:low']));
    expect(r3.state.entities.email.value).toBe('ana@example.com');
    expect(r3.state.entities.order_id.value).toBe('xpto123');
    expect(r3.state.normalized_context.session_id).toBe('sess-smoke-1');
    expect(r3.state.normalized_context.funnel_state.stage).toBe('decision');
  });
});
